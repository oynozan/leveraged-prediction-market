import { expect } from "chai";
import { ethers } from "hardhat";
import { Vault, LPPool, CircuitBreaker } from "../typechain-types";
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

describe("Vault", () => {
    let pool: LPPool;
    let cb: CircuitBreaker;
    let vault: Vault;
    let admin: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let operator: HardhatEthersSigner;
    let bridge: HardhatEthersSigner;

    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const BRIDGE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE"));
    const BORROWER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BORROWER_ROLE"));

    beforeEach(async () => {
        [admin, user, operator, bridge] = await ethers.getSigners();

        const LPPoolFactory = await ethers.getContractFactory("LPPool");
        pool = await LPPoolFactory.deploy(USDC_ADDRESS);

        const CB = await ethers.getContractFactory("CircuitBreaker");
        cb = await CB.deploy();

        const VaultFactory = await ethers.getContractFactory("Vault");
        vault = await VaultFactory.deploy(
            USDC_ADDRESS,
            await pool.getAddress(),
            SWAP_ROUTER_ADDRESS,
            WETH_ADDRESS,
            await cb.getAddress(),
        );

        await vault.grantRole(OPERATOR_ROLE, operator.address);
        await vault.grantRole(BRIDGE_ROLE, bridge.address);
        await pool.grantRole(BORROWER_ROLE, await vault.getAddress());

        await fundWithUSDC(user.address, USDC(50_000));
        const usdc = await getUSDC();
        await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    describe("Margin Management", () => {
        it("should accept USDC deposits", async () => {
            await vault.connect(user).depositMargin(USDC(1_000));
            const m = await vault.getMargin(user.address);
            expect(m.total).to.equal(USDC(1_000));
            expect(m.available).to.equal(USDC(1_000));
        });

        it("should allow withdrawals", async () => {
            await vault.connect(user).depositMargin(USDC(1_000));
            await vault.connect(user).withdrawMargin(USDC(500));
            const m = await vault.getMargin(user.address);
            expect(m.total).to.equal(USDC(500));
        });

        it("should revert withdrawal exceeding available", async () => {
            await vault.connect(user).depositMargin(USDC(1_000));
            await vault.connect(operator).lockMargin(user.address, USDC(800));
            await expect(
                vault.connect(user).withdrawMargin(USDC(300)),
            ).to.be.revertedWith("Vault: insufficient available margin");
        });
    });

    describe("Lock / Release Margin", () => {
        beforeEach(async () => {
            await vault.connect(user).depositMargin(USDC(5_000));
        });

        it("should lock margin", async () => {
            await vault.connect(operator).lockMargin(user.address, USDC(3_000));
            const m = await vault.getMargin(user.address);
            expect(m.locked).to.equal(USDC(3_000));
            expect(m.available).to.equal(USDC(2_000));
        });

        it("should release margin", async () => {
            await vault.connect(operator).lockMargin(user.address, USDC(3_000));
            await vault.connect(operator).releaseMargin(user.address, USDC(1_000));
            const m = await vault.getMargin(user.address);
            expect(m.locked).to.equal(USDC(2_000));
        });

        it("should revert if non-operator locks", async () => {
            await expect(
                vault.connect(user).lockMargin(user.address, USDC(1_000)),
            ).to.be.reverted;
        });
    });

    describe("Swap Deposit (real Uniswap V3)", () => {
        beforeEach(async () => {
            await fundWithWETH(user.address, ethers.parseEther("10"));
            const weth = await getWETH();
            await weth.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
        });

        it("should swap WETH to USDC and credit margin", async () => {
            await vault.connect(user).depositWithSwap(
                WETH_ADDRESS,
                ethers.parseEther("1"),
                USDC(1), // min 1 USDC — real swap will produce market rate
                3000,
            );

            const m = await vault.getMargin(user.address);
            expect(m.total).to.be.gt(0);
        });

        it("should revert if slippage too high", async () => {
            await expect(
                vault.connect(user).depositWithSwap(
                    WETH_ADDRESS,
                    ethers.parseEther("1"),
                    USDC(100_000_000), // impossibly high minimum
                    3000,
                ),
            ).to.be.reverted;
        });
    });

    describe("Borrow / Repay from Pool", () => {
        beforeEach(async () => {
            await fundWithUSDC(admin.address, USDC(100_000));
            const usdc = await getUSDC();
            await usdc.connect(admin).approve(await pool.getAddress(), ethers.MaxUint256);
            await pool.connect(admin).deposit(USDC(100_000), admin.address);

            await fundWithUSDC(await vault.getAddress(), USDC(100_000));
        });

        it("should borrow from pool", async () => {
            await vault.connect(operator).borrowFromPool(USDC(10_000));
            expect(await pool.totalBorrowed()).to.equal(USDC(10_000));
        });

        it("should repay to pool", async () => {
            await vault.connect(operator).borrowFromPool(USDC(10_000));
            await vault.connect(operator).repayToPool(USDC(10_000));
            expect(await pool.totalBorrowed()).to.equal(0);
        });
    });

    describe("CCIP Credit Balance", () => {
        it("should credit balance and emit event", async () => {
            const msgId = ethers.id("test-ccip-msg");
            const sourceChain = 1n;

            await expect(
                vault.connect(bridge).creditBalance(user.address, USDC(500), sourceChain, msgId),
            )
                .to.emit(vault, "CCIPDepositReceived")
                .withArgs(msgId, sourceChain, user.address, USDC(500));

            const m = await vault.getMargin(user.address);
            expect(m.total).to.equal(USDC(500));
        });

        it("should reject duplicate messages", async () => {
            const msgId = ethers.id("test-ccip-msg");
            await vault.connect(bridge).creditBalance(user.address, USDC(500), 1n, msgId);

            await expect(
                vault.connect(bridge).creditBalance(user.address, USDC(500), 1n, msgId),
            ).to.be.revertedWith("Vault: message already processed");
        });

        it("should reject non-bridge callers", async () => {
            await expect(
                vault.connect(user).creditBalance(user.address, USDC(500), 1n, ethers.id("x")),
            ).to.be.reverted;
        });
    });

    describe("Pause", () => {
        it("should block deposits when paused", async () => {
            await vault.pause();
            await expect(vault.connect(user).depositMargin(USDC(100))).to.be.reverted;
        });

        it("should allow deposits after unpause", async () => {
            await vault.pause();
            await vault.unpause();
            await vault.connect(user).depositMargin(USDC(100));
            const m = await vault.getMargin(user.address);
            expect(m.total).to.equal(USDC(100));
        });
    });
});
