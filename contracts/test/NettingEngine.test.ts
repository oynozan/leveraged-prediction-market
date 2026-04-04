import { expect } from "chai";
import { ethers } from "hardhat";
import { NettingEngine, CircuitBreaker } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("NettingEngine", () => {
    let engine: NettingEngine;
    let cb: CircuitBreaker;
    let admin: HardhatEthersSigner;
    let operator: HardhatEthersSigner;
    let rebalancer: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;

    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const REBALANCER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REBALANCER_ROLE"));
    const CB_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CIRCUIT_BREAKER_ROLE"));

    const conditionA = ethers.id("market-A");
    const conditionB = ethers.id("market-B");
    const TOKENS = (n: number) => ethers.parseUnits(n.toString(), 6);

    beforeEach(async () => {
        [admin, operator, rebalancer, user1, user2] = await ethers.getSigners();

        const CB = await ethers.getContractFactory("CircuitBreaker");
        cb = await CB.deploy();

        const NE = await ethers.getContractFactory("NettingEngine");
        engine = await NE.deploy(await cb.getAddress());

        await engine.grantRole(OPERATOR_ROLE, operator.address);
        await engine.grantRole(REBALANCER_ROLE, rebalancer.address);
    });

    describe("Open / Close Positions", () => {
        it("should track YES positions", async () => {
            await engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(1_000));

            const state = await engine.getNettingState(conditionA);
            expect(state.totalYes).to.equal(TOKENS(1_000));
            expect(state.totalNo).to.equal(0);
            expect(state.matchedPairs).to.equal(0);
        });

        it("should track NO positions", async () => {
            await engine.connect(operator).openPosition(user1.address, conditionA, false, TOKENS(500));

            const state = await engine.getNettingState(conditionA);
            expect(state.totalNo).to.equal(TOKENS(500));
        });

        it("should calculate matchedPairs correctly", async () => {
            await engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(3_000));
            await engine.connect(operator).openPosition(user2.address, conditionA, false, TOKENS(2_000));

            const state = await engine.getNettingState(conditionA);
            expect(state.totalYes).to.equal(TOKENS(3_000));
            expect(state.totalNo).to.equal(TOKENS(2_000));
            expect(state.matchedPairs).to.equal(TOKENS(2_000));
        });

        it("should close positions and update matchedPairs", async () => {
            await engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(5_000));
            await engine.connect(operator).openPosition(user2.address, conditionA, false, TOKENS(3_000));
            await engine.connect(operator).closePosition(user1.address, conditionA, true, TOKENS(2_000));

            const state = await engine.getNettingState(conditionA);
            expect(state.totalYes).to.equal(TOKENS(3_000));
            expect(state.matchedPairs).to.equal(TOKENS(3_000));
        });

        it("should revert closing more than total", async () => {
            await engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(100));
            await expect(
                engine.connect(operator).closePosition(user1.address, conditionA, true, TOKENS(200))
            ).to.be.revertedWith("NettingEngine: exceeds total YES");
        });

        it("should keep markets separate", async () => {
            await engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(1_000));
            await engine.connect(operator).openPosition(user1.address, conditionB, false, TOKENS(2_000));

            const stateA = await engine.getNettingState(conditionA);
            const stateB = await engine.getNettingState(conditionB);
            expect(stateA.totalYes).to.equal(TOKENS(1_000));
            expect(stateB.totalNo).to.equal(TOKENS(2_000));
        });
    });

    describe("Events (CRE ABI)", () => {
        it("should emit PositionOpened", async () => {
            await expect(
                engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(500))
            )
                .to.emit(engine, "PositionOpened")
                .withArgs(user1.address, conditionA, true, TOKENS(500));
        });

        it("should emit PositionClosed", async () => {
            await engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(500));
            await expect(
                engine.connect(operator).closePosition(user1.address, conditionA, true, TOKENS(500))
            )
                .to.emit(engine, "PositionClosed")
                .withArgs(user1.address, conditionA, true, TOKENS(500));
        });
    });

    describe("Rebalance Recording", () => {
        it("should record positive deltas", async () => {
            await engine.connect(rebalancer).recordRebalance(conditionA, TOKENS(1_000), TOKENS(1_000), ethers.id("order-1"));

            const holdings = await engine.getCurrentHoldings(conditionA);
            expect(holdings.realYesTokens).to.equal(TOKENS(1_000));
            expect(holdings.realNoTokens).to.equal(TOKENS(1_000));
        });

        it("should handle negative deltas (selling tokens)", async () => {
            await engine.connect(rebalancer).recordRebalance(conditionA, TOKENS(2_000), TOKENS(2_000), ethers.id("order-1"));
            await engine.connect(rebalancer).recordRebalance(conditionA, -TOKENS(500), -TOKENS(500), ethers.id("order-2"));

            const holdings = await engine.getCurrentHoldings(conditionA);
            expect(holdings.realYesTokens).to.equal(TOKENS(1_500));
            expect(holdings.realNoTokens).to.equal(TOKENS(1_500));
        });

        it("should emit RebalanceExecuted", async () => {
            await expect(
                engine.connect(rebalancer).recordRebalance(conditionA, TOKENS(100), TOKENS(100), ethers.id("order-1"))
            )
                .to.emit(engine, "RebalanceExecuted")
                .withArgs(conditionA, TOKENS(100), TOKENS(100), ethers.id("order-1"));
        });

        it("should revert negative underflow", async () => {
            await expect(
                engine.connect(rebalancer).recordRebalance(conditionA, -1n, 0n, ethers.id("x"))
            ).to.be.revertedWith("NettingEngine: negative YES underflow");
        });

        it("should reject non-rebalancer", async () => {
            await expect(
                engine.connect(operator).recordRebalance(conditionA, 1n, 1n, ethers.id("x"))
            ).to.be.reverted;
        });
    });

    describe("Circuit Breaker Integration", () => {
        it("should block positions when market is paused", async () => {
            await cb.grantRole(CB_ROLE, admin.address);
            await cb.processPauseCommand(conditionA, 500, true);

            await expect(
                engine.connect(operator).openPosition(user1.address, conditionA, true, TOKENS(100))
            ).to.be.revertedWith("NettingEngine: market paused");
        });
    });

    describe("Access Control", () => {
        it("should reject non-operator from opening positions", async () => {
            await expect(
                engine.connect(user1).openPosition(user1.address, conditionA, true, TOKENS(100))
            ).to.be.reverted;
        });
    });
});
