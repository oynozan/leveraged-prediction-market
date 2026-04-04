import { expect } from "chai";
import { ethers } from "hardhat";
import { FeeDistributor, LPPool } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { USDC_ADDRESS, USDC, fundWithUSDC, getUSDC } from "./helpers";

describe("FeeDistributor", () => {
    let pool: LPPool;
    let feeDist: FeeDistributor;
    let admin: HardhatEthersSigner;
    let vaultSigner: HardhatEthersSigner;

    const VAULT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VAULT_ROLE"));

    beforeEach(async () => {
        [admin, vaultSigner] = await ethers.getSigners();

        const LPPoolFactory = await ethers.getContractFactory("LPPool");
        pool = await LPPoolFactory.deploy(USDC_ADDRESS);

        const FD = await ethers.getContractFactory("FeeDistributor");
        feeDist = await FD.deploy(USDC_ADDRESS, await pool.getAddress());

        await feeDist.grantRole(VAULT_ROLE, vaultSigner.address);

        await fundWithUSDC(vaultSigner.address, USDC(100_000));
        const usdc = await getUSDC();
        await usdc.connect(vaultSigner).approve(await feeDist.getAddress(), ethers.MaxUint256);
    });

    describe("Fee Collection", () => {
        it("should collect fees from vault", async () => {
            await feeDist.connect(vaultSigner).collectFee(USDC(1_000));
            expect(await feeDist.pendingFees()).to.equal(USDC(1_000));
        });

        it("should emit FeeCollected", async () => {
            await expect(feeDist.connect(vaultSigner).collectFee(USDC(500)))
                .to.emit(feeDist, "FeeCollected")
                .withArgs(vaultSigner.address, USDC(500));
        });

        it("should reject non-vault callers", async () => {
            await expect(feeDist.connect(admin).collectFee(USDC(100))).to.be.reverted;
        });

        it("should reject zero amount", async () => {
            await expect(
                feeDist.connect(vaultSigner).collectFee(0),
            ).to.be.revertedWith("FeeDistributor: zero amount");
        });
    });

    describe("Distribution", () => {
        beforeEach(async () => {
            await fundWithUSDC(admin.address, USDC(10_000));
            const usdc = await getUSDC();
            await usdc.connect(admin).approve(await pool.getAddress(), ethers.MaxUint256);
            await pool.connect(admin).deposit(USDC(10_000), admin.address);

            await feeDist.connect(vaultSigner).collectFee(USDC(1_000));
        });

        it("should distribute fees directly to LP pool (raising share price)", async () => {
            const totalBefore = await pool.totalAssets();
            const supplyBefore = await pool.totalSupply();

            await feeDist.distribute();

            const totalAfter = await pool.totalAssets();
            const supplyAfter = await pool.totalSupply();

            expect(totalAfter).to.be.gt(totalBefore);
            expect(supplyAfter).to.equal(supplyBefore);
            expect(await feeDist.pendingFees()).to.equal(0);
        });

        it("should emit FeesDistributed", async () => {
            await expect(feeDist.distribute()).to.emit(feeDist, "FeesDistributed");
        });

        it("should revert when nothing to distribute", async () => {
            await feeDist.distribute();
            await expect(feeDist.distribute()).to.be.revertedWith(
                "FeeDistributor: nothing to distribute",
            );
        });
    });
});
