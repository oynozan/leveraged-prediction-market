import { expect } from "chai";
import { ethers } from "hardhat";
import { CircuitBreaker } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("CircuitBreaker", () => {
    let cb: CircuitBreaker;
    let admin: HardhatEthersSigner;
    let cbCaller: HardhatEthersSigner;
    let other: HardhatEthersSigner;

    const CB_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CIRCUIT_BREAKER_ROLE"));
    const conditionA = ethers.id("market-A");
    const conditionB = ethers.id("market-B");

    beforeEach(async () => {
        [admin, cbCaller, other] = await ethers.getSigners();

        const CB = await ethers.getContractFactory("CircuitBreaker");
        cb = await CB.deploy();

        await cb.grantRole(CB_ROLE, cbCaller.address);
    });

    describe("processPauseCommand", () => {
        it("should pause a market", async () => {
            await cb.connect(cbCaller).processPauseCommand(conditionA, 500, true);
            expect(await cb.isMarketPaused(conditionA)).to.be.true;
        });

        it("should unpause a market", async () => {
            await cb.connect(cbCaller).processPauseCommand(conditionA, 500, true);
            await cb.connect(cbCaller).processPauseCommand(conditionA, 0, false);
            expect(await cb.isMarketPaused(conditionA)).to.be.false;
        });

        it("should emit MarketPaused event", async () => {
            await expect(
                cb.connect(cbCaller).processPauseCommand(conditionA, 750, true)
            )
                .to.emit(cb, "MarketPaused")
                .withArgs(conditionA, 750);
        });

        it("should emit MarketUnpaused event", async () => {
            await cb.connect(cbCaller).processPauseCommand(conditionA, 500, true);
            await expect(
                cb.connect(cbCaller).processPauseCommand(conditionA, 0, false)
            )
                .to.emit(cb, "MarketUnpaused")
                .withArgs(conditionA);
        });

        it("should not emit when pausing already-paused market", async () => {
            await cb.connect(cbCaller).processPauseCommand(conditionA, 500, true);
            await expect(
                cb.connect(cbCaller).processPauseCommand(conditionA, 600, true)
            ).to.not.emit(cb, "MarketPaused");
        });

        it("should keep markets independent", async () => {
            await cb.connect(cbCaller).processPauseCommand(conditionA, 500, true);
            expect(await cb.isMarketPaused(conditionA)).to.be.true;
            expect(await cb.isMarketPaused(conditionB)).to.be.false;
        });

        it("should reject non-CB-role callers", async () => {
            await expect(
                cb.connect(other).processPauseCommand(conditionA, 500, true)
            ).to.be.reverted;
        });
    });

    describe("Global Pause", () => {
        it("should pause all markets via globalPause", async () => {
            await cb.setGlobalPause(true);
            expect(await cb.isMarketPaused(conditionA)).to.be.true;
            expect(await cb.isMarketPaused(conditionB)).to.be.true;
        });

        it("should emit GlobalPauseSet", async () => {
            await expect(cb.setGlobalPause(true))
                .to.emit(cb, "GlobalPauseSet")
                .withArgs(true);
        });

        it("should restrict globalPause to admin", async () => {
            await expect(
                cb.connect(other).setGlobalPause(true)
            ).to.be.reverted;
        });
    });

    describe("lastPauseTimestamp", () => {
        it("should record timestamp on pause", async () => {
            await cb.connect(cbCaller).processPauseCommand(conditionA, 500, true);
            const ts = await cb.lastPauseTimestamp(conditionA);
            expect(ts).to.be.gt(0);
        });
    });
});
