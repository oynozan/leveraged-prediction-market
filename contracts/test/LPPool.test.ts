import { expect } from "chai";
import { ethers } from "hardhat";
import { LPPool } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { USDC_ADDRESS, USDC, fundWithUSDC, getUSDC } from "./helpers";

describe("LPPool", () => {
    let pool: LPPool;
    let admin: HardhatEthersSigner;
    let lp1: HardhatEthersSigner;
    let lp2: HardhatEthersSigner;
    let borrower: HardhatEthersSigner;

    const BORROWER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BORROWER_ROLE"));

    beforeEach(async () => {
        [admin, lp1, lp2, borrower] = await ethers.getSigners();

        const LPPool = await ethers.getContractFactory("LPPool");
        pool = await LPPool.deploy(USDC_ADDRESS);

        await pool.grantRole(BORROWER_ROLE, borrower.address);

        await fundWithUSDC(lp1.address, USDC(100_000));
        await fundWithUSDC(lp2.address, USDC(50_000));
        await fundWithUSDC(borrower.address, USDC(100_000));

        const usdc = await getUSDC();
        await usdc.connect(lp1).approve(await pool.getAddress(), ethers.MaxUint256);
        await usdc.connect(lp2).approve(await pool.getAddress(), ethers.MaxUint256);
        await usdc.connect(borrower).approve(await pool.getAddress(), ethers.MaxUint256);
    });

    describe("Deposit / Withdraw", () => {
        it("should accept deposits and mint shares", async () => {
            await pool.connect(lp1).deposit(USDC(10_000), lp1.address);
            expect(await pool.balanceOf(lp1.address)).to.be.gt(0);
            expect(await pool.totalAssets()).to.equal(USDC(10_000));
        });

        it("should allow withdrawals", async () => {
            const usdc = await getUSDC();
            const balBefore = await usdc.balanceOf(lp1.address);

            await pool.connect(lp1).deposit(USDC(10_000), lp1.address);
            const shares = await pool.balanceOf(lp1.address);
            await pool.connect(lp1).redeem(shares, lp1.address, lp1.address);

            expect(await usdc.balanceOf(lp1.address)).to.equal(balBefore);
        });

        it("should handle multiple LPs", async () => {
            await pool.connect(lp1).deposit(USDC(10_000), lp1.address);
            await pool.connect(lp2).deposit(USDC(5_000), lp2.address);
            expect(await pool.totalAssets()).to.equal(USDC(15_000));
        });
    });

    describe("Borrow / Repay", () => {
        beforeEach(async () => {
            await pool.connect(lp1).deposit(USDC(10_000), lp1.address);
        });

        it("should allow borrower to borrow", async () => {
            await pool.connect(borrower).borrow(USDC(5_000));
            expect(await pool.totalBorrowed()).to.equal(USDC(5_000));
            expect(await pool.availableLiquidity()).to.equal(USDC(5_000));
        });

        it("should allow borrower to repay", async () => {
            await pool.connect(borrower).borrow(USDC(5_000));
            await pool.connect(borrower).repay(USDC(5_000));
            expect(await pool.totalBorrowed()).to.equal(0);
        });

        it("should revert if utilization cap exceeded", async () => {
            await expect(
                pool.connect(borrower).borrow(USDC(9_000)),
            ).to.be.revertedWith("LPPool: utilization cap exceeded");
        });

        it("should revert if non-borrower tries to borrow", async () => {
            await expect(pool.connect(lp1).borrow(USDC(1_000))).to.be.reverted;
        });

        it("should revert borrow exceeding available liquidity", async () => {
            await expect(
                pool.connect(borrower).borrow(USDC(10_001)),
            ).to.be.revertedWith("LPPool: insufficient liquidity");
        });
    });

    describe("Share price after borrow", () => {
        it("totalAssets should include borrowed amount", async () => {
            await pool.connect(lp1).deposit(USDC(10_000), lp1.address);
            await pool.connect(borrower).borrow(USDC(5_000));
            expect(await pool.totalAssets()).to.equal(USDC(10_000));
        });
    });

    describe("Interest rate model", () => {
        it("should return base rate at 0% utilization", async () => {
            await pool.connect(lp1).deposit(USDC(10_000), lp1.address);
            expect(await pool.currentInterestRate()).to.equal(200);
        });

        it("should increase rate with utilization", async () => {
            await pool.connect(lp1).deposit(USDC(10_000), lp1.address);
            await pool.connect(borrower).borrow(USDC(4_000));
            const rate = await pool.currentInterestRate();
            expect(rate).to.be.gt(200);
        });

        it("should return 0 for empty pool", async () => {
            expect(await pool.utilizationRate()).to.equal(0);
        });
    });

    describe("Admin", () => {
        it("should allow admin to update interest rate params", async () => {
            await pool.setInterestRateParams(100, 1500, 8000, 7500);
            expect(await pool.baseRate()).to.equal(100);
            expect(await pool.kinkRate()).to.equal(1500);
        });

        it("should reject invalid rate params", async () => {
            await expect(
                pool.setInterestRateParams(2000, 1000, 500, 8000),
            ).to.be.revertedWith("LPPool: invalid rate params");
        });

        it("should allow admin to update max utilization", async () => {
            await pool.setMaxUtilization(9000);
            expect(await pool.maxUtilizationBps()).to.equal(9000);
        });
    });
});
