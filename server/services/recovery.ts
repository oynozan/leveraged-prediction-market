import Position from "../models/Positions";
import { getUserMargin, releaseMargin, repayToPool } from "./vault";
import {
    getPolymarketWalletBalance,
    swapUsdcEToNativeUsdc,
    returnFundsToVault,
} from "./polymarket-clob";
import { broadcastMarginUpdate } from "../socket/broadcast";

interface RecoveryResult {
    wallet: string;
    onChainLocked: string;
    expectedLocked: string;
    excessReleased: string;
    status: "ok" | "recovered" | "error";
    error?: string;
}

/**
 * For a single wallet, compare on-chain locked margin against the sum of
 * marginAmount from all open positions in the DB. If on-chain locked exceeds
 * the DB expectation, release the excess back to the user.
 */
export async function reconcileWallet(wallet: string): Promise<RecoveryResult> {
    const openPositions = await Position.find({ wallet, status: "open" }).lean();

    const expectedLockedMicro = openPositions.reduce((sum, p) => {
        return sum + BigInt(Math.round(p.marginAmount * 1e6));
    }, 0n);

    const margin = await getUserMargin(wallet);
    const onChainLocked = BigInt(margin.locked);

    console.log(
        `[recovery] wallet=${wallet.slice(0, 10)}... onChainLocked=${onChainLocked} expectedLocked=${expectedLockedMicro} openPositions=${openPositions.length}`,
    );

    if (onChainLocked <= expectedLockedMicro) {
        return {
            wallet,
            onChainLocked: onChainLocked.toString(),
            expectedLocked: expectedLockedMicro.toString(),
            excessReleased: "0",
            status: "ok",
        };
    }

    const excess = onChainLocked - expectedLockedMicro;
    console.log(`[recovery] MISMATCH detected for ${wallet.slice(0, 10)}... excess=${excess} — releasing`);

    try {
        await releaseMargin(wallet, excess.toString());
        console.log(`[recovery] Released ${excess} locked margin for ${wallet.slice(0, 10)}...`);
        broadcastMarginUpdate(wallet).catch(() => {});

        return {
            wallet,
            onChainLocked: onChainLocked.toString(),
            expectedLocked: expectedLockedMicro.toString(),
            excessReleased: excess.toString(),
            status: "recovered",
        };
    } catch (err: any) {
        console.error(`[recovery] Failed to release excess for ${wallet.slice(0, 10)}...`, err.message);
        return {
            wallet,
            onChainLocked: onChainLocked.toString(),
            expectedLocked: expectedLockedMicro.toString(),
            excessReleased: "0",
            status: "error",
            error: err.message,
        };
    }
}

/**
 * Also reconcile LP borrows: if a position is closed in DB but repayToPool
 * failed, the borrowed amount is still on-chain. Find closed positions
 * where borrowedAmount > 0 and settled=false, and retry repayment.
 */
async function reconcileFailedRepayments(): Promise<{ repaid: number; failed: number }> {
    const stalePositions = await Position.find({
        status: "closed",
        settled: false,
        borrowedAmount: { $gt: 0 },
    }).lean();

    let repaid = 0;
    let failed = 0;

    for (const pos of stalePositions) {
        const borrowedMicro = BigInt(Math.round(pos.borrowedAmount * 1e6));
        console.log(
            `[recovery] Retrying repayToPool for closed position ${pos._id} conditionId=${pos.conditionId.slice(0, 10)}... amount=${borrowedMicro}`,
        );

        try {
            await repayToPool(pos.conditionId, borrowedMicro.toString());
            await Position.updateOne({ _id: pos._id }, { $set: { settled: true } });
            console.log(`[recovery] Repaid and settled position ${pos._id}`);
            repaid++;
        } catch (err: any) {
            if (err.message?.includes("repay exceeds borrowed")) {
                console.log(`[recovery] Already repaid for ${pos._id}, marking settled`);
                await Position.updateOne({ _id: pos._id }, { $set: { settled: true } });
            } else {
                console.error(`[recovery] repayToPool retry failed for ${pos._id}:`, err.message);
                failed++;
            }
        }
    }

    return { repaid, failed };
}

/**
 * Sweep any USDC.e sitting in the Polymarket wallet back to the Vault.
 * This recovers funds from closed trades that never returned USDC.
 */
export async function sweepFundsToVault(): Promise<{ swept: string }> {
    console.log("[recovery] === SWEEP FUNDS TO VAULT ===");

    const usdceBal = await getPolymarketWalletBalance();
    console.log(`[recovery] Polymarket wallet USDC.e balance: ${usdceBal}`);

    if (usdceBal === 0n) {
        console.log("[recovery] Nothing to sweep");
        return { swept: "0" };
    }

    try {
        console.log(`[recovery] Swapping ${usdceBal} USDC.e → native USDC...`);
        await swapUsdcEToNativeUsdc(usdceBal);

        console.log(`[recovery] Transferring native USDC → Vault...`);
        await returnFundsToVault(usdceBal);

        console.log(`[recovery] Sweep complete: ${usdceBal} returned to Vault`);
        return { swept: usdceBal.toString() };
    } catch (err: any) {
        console.error(`[recovery] Sweep failed:`, err.message);
        return { swept: "0" };
    }
}

/**
 * Full reconciliation: sweep funds back to vault, reconcile wallets,
 * and retry failed LP repayments.
 */
export async function reconcileAll(): Promise<{
    results: RecoveryResult[];
    repayments: { repaid: number; failed: number };
    sweep: { swept: string };
}> {
    console.log("[recovery] === FULL RECONCILIATION START ===");

    const sweep = { swept: "0" };

    const fixedCount = await Position.updateMany(
        { status: "closed", borrowedAmount: { $gt: 0 }, settled: true },
        { $set: { settled: false } },
    );
    if (fixedCount.modifiedCount > 0) {
        console.log(`[recovery] Marked ${fixedCount.modifiedCount} closed position(s) as unsettled for LP repay retry`);
    }

    const wallets: string[] = await Position.distinct("wallet");
    console.log(`[recovery] Found ${wallets.length} unique wallet(s) to check`);

    const results: RecoveryResult[] = [];

    for (const wallet of wallets) {
        try {
            const result = await reconcileWallet(wallet);
            results.push(result);
        } catch (err: any) {
            console.error(`[recovery] Error reconciling ${wallet.slice(0, 10)}...`, err.message);
            results.push({
                wallet,
                onChainLocked: "?",
                expectedLocked: "?",
                excessReleased: "0",
                status: "error",
                error: err.message,
            });
        }
    }

    const repayments = await reconcileFailedRepayments();

    const recovered = results.filter(r => r.status === "recovered").length;
    const errors = results.filter(r => r.status === "error").length;

    console.log(
        `[recovery] === RECONCILIATION DONE === wallets=${wallets.length} recovered=${recovered} errors=${errors} lpRepaid=${repayments.repaid} lpFailed=${repayments.failed} swept=${sweep.swept}`,
    );

    return { results, repayments, sweep };
}
