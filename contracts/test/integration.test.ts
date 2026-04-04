import { expect } from "chai";
import { ethers } from "hardhat";
import {
    LPPool,
    Vault,
    NettingEngine,
    CircuitBreaker,
    FeeDistributor,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
    USDC_ADDRESS,
    WETH_ADDRESS,
    SWAP_ROUTER_ADDRESS,
    USDC,
    fundWithUSDC,
    fundWithWETH,
    getUSDC,
    getWETH,
} from "./helpers";

describe("Integration", () => {
    let pool: LPPool;
    let vault: Vault;
    let engine: NettingEngine;
    let cb: CircuitBreaker;
    let feeDist: FeeDistributor;

    let admin: HardhatEthersSigner;
    let lp: HardhatEthersSigner;
    let trader: HardhatEthersSigner;
    let operator: HardhatEthersSigner;
    let rebalancer: HardhatEthersSigner;

    const BORROWER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BORROWER_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const REBALANCER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBALANCER_ROLE"));
    const VAULT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VAULT_ROLE"));

    const conditionA = ethers.id("market-will-X-happen");

    beforeEach(async () => {
        [admin, lp, trader, operator, rebalancer] = await ethers.getSigners();

        const CB = await ethers.getContractFactory("CircuitBreaker");
        cb = await CB.deploy();

        const NE = await ethers.getContractFactory("NettingEngine");
        engine = await NE.deploy(await cb.getAddress());

        const LP = await ethers.getContractFactory("LPPool");
        pool = await LP.deploy(USDC_ADDRESS);

        const V = await ethers.getContractFactory("Vault");
        vault = await V.deploy(
            USDC_ADDRESS,
            await pool.getAddress(),
            SWAP_ROUTER_ADDRESS,
            WETH_ADDRESS,
            await cb.getAddress(),
        );

        const FD = await ethers.getContractFactory("FeeDistributor");
        feeDist = await FD.deploy(USDC_ADDRESS, await pool.getAddress());

        await pool.grantRole(BORROWER_ROLE, await vault.getAddress());
        await vault.grantRole(OPERATOR_ROLE, operator.address);
        await engine.grantRole(OPERATOR_ROLE, operator.address);
        await engine.grantRole(REBALANCER_ROLE, rebalancer.address);
        await feeDist.grantRole(VAULT_ROLE, operator.address);

        await fundWithUSDC(lp.address, USDC(100_000));
        await fundWithUSDC(trader.address, USDC(10_000));
        await fundWithUSDC(operator.address, USDC(10_000));
        await fundWithUSDC(await vault.getAddress(), USDC(100_000));

        const usdc = await getUSDC();
        await usdc.connect(lp).approve(await pool.getAddress(), ethers.MaxUint256);
        await usdc.connect(trader).approve(await vault.getAddress(), ethers.MaxUint256);
        await usdc.connect(operator).approve(await feeDist.getAddress(), ethers.MaxUint256);
    });

    it("should handle a full lifecycle: deposit -> open -> rebalance -> close -> fees -> withdraw", async () => {
        const usdc = await getUSDC();

        // 1. LP deposits into pool
        await pool.connect(lp).deposit(USDC(50_000), lp.address);
        expect(await pool.totalAssets()).to.equal(USDC(50_000));

        // 2. Trader deposits margin into vault
        await vault.connect(trader).depositMargin(USDC(1_000));
        const marginAfterDeposit = await vault.getMargin(trader.address);
        expect(marginAfterDeposit.total).to.equal(USDC(1_000));

        // 3. Operator locks margin for a 3x leveraged position
        await vault.connect(operator).lockMargin(trader.address, USDC(1_000));

        // 4. Operator borrows 2x from pool
        await vault.connect(operator).borrowFromPool(USDC(2_000));
        expect(await pool.totalBorrowed()).to.equal(USDC(2_000));

        // 5. Operator opens position in netting engine
        await engine.connect(operator).openPosition(trader.address, conditionA, true, USDC(6_000));
        const stateAfterOpen = await engine.getNettingState(conditionA);
        expect(stateAfterOpen.totalYes).to.equal(USDC(6_000));

        // 6. Rebalancer records real token purchase
        await engine
            .connect(rebalancer)
            .recordRebalance(conditionA, USDC(6_000), USDC(6_000), ethers.id("rebal-order-1"));
        const holdings = await engine.getCurrentHoldings(conditionA);
        expect(holdings.realYesTokens).to.equal(USDC(6_000));
        expect(holdings.realNoTokens).to.equal(USDC(6_000));

        // 7. Trader closes position
        await engine
            .connect(operator)
            .closePosition(trader.address, conditionA, true, USDC(6_000));
        const stateAfterClose = await engine.getNettingState(conditionA);
        expect(stateAfterClose.totalYes).to.equal(0);

        // 8. Operator repays pool
        await vault.connect(operator).repayToPool(USDC(2_000));
        expect(await pool.totalBorrowed()).to.equal(0);

        // 9. Release margin
        await vault.connect(operator).releaseMargin(trader.address, USDC(1_000));

        // 10. Collect fees and distribute to LP
        await feeDist.connect(operator).collectFee(USDC(100));
        const poolTotalBefore = await pool.totalAssets();
        await feeDist.distribute();
        const poolTotalAfter = await pool.totalAssets();
        expect(poolTotalAfter).to.be.gt(poolTotalBefore);

        // 11. LP withdraws (should have more USDC due to fees)
        const lpBalBefore = await usdc.balanceOf(lp.address);
        const shares = await pool.balanceOf(lp.address);
        await pool.connect(lp).redeem(shares, lp.address, lp.address);
        const lpBalAfter = await usdc.balanceOf(lp.address);
        expect(lpBalAfter).to.be.gt(lpBalBefore);
    });

    it("should handle swap deposit with real Uniswap", async () => {
        await fundWithWETH(trader.address, ethers.parseEther("2"));
        const weth = await getWETH();
        await weth.connect(trader).approve(await vault.getAddress(), ethers.MaxUint256);

        await vault.connect(trader).depositWithSwap(
            WETH_ADDRESS,
            ethers.parseEther("1"),
            USDC(1), // any non-zero minimum — real swap against Polygon liquidity
            3000,
        );

        const m = await vault.getMargin(trader.address);
        expect(m.total).to.be.gt(0);
    });
});
