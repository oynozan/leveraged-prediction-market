import Market from "../models/Markets";
import Position from "../models/Positions";
import {
    placeMarketOrder,
    fetchMidpoint,
    fetchBestPrice,
    fetchNegRisk,
    fetchTickSize,
    getPolymarketWalletBalance,
    getConditionalTokenBalance,
    swapNativeUsdcToUsdcE,
    swapUsdcEToNativeUsdc,
    returnFundsToVault,
    ensureExchangeApproval,
    ensureConditionalTokenApproval,
} from "./polymarket-clob";
import {
    getUserMargin,
    lockMargin,
    releaseMargin,
    borrowFromPool,
    repayToPool,
    fundPolymarketWallet,
    clearMarginCache,
} from "./vault";
import { getPoolStats } from "./pool";
import { reconcileWallet } from "./recovery";
import { resetNonce } from "../lib/contracts";
import { broadcastPositionUpdate, broadcastTradeProgress } from "../socket/broadcast";

const MAX_SLIPPAGE_BPS = 200;
const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

function roundTick(price: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round(price * factor) / factor;
}

function applySlippage(price: number, tickDecimals = 2): number {
    const raw = price * (1 + MAX_SLIPPAGE_BPS / 10_000);
    return Math.min(0.999, roundTick(raw, tickDecimals));
}

function toMicro(usd: number): bigint {
    return BigInt(Math.round(usd * USDC_SCALE));
}

function usd(micro: bigint | string): string {
    const n = Number(BigInt(micro)) / USDC_SCALE;
    return `$${n.toFixed(2)}`;
}

/* ---------- Separate locks for open / close ---------- */

const _openLocks = new Map<string, Promise<unknown>>();
const _closeLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(locks: Map<string, Promise<unknown>>, key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const current = prev.then(fn, fn);
    locks.set(key, current);
    try {
        return await current;
    } finally {
        if (locks.get(key) === current) locks.delete(key);
    }
}

/* ---------- Pending settlement tracker ---------- */

const _pendingSettlements = new Map<string, Promise<void>>();

function settlementKey(wallet: string, conditionId: string): string {
    return `${wallet}:${conditionId}`;
}

/* ---------- Public API ---------- */

export interface TradeParams {
    wallet: string;
    conditionId: string;
    outcome: "Yes" | "No";
    amount: number;
    leverage: number;
}

export interface TradeResult {
    position: typeof Position.prototype;
    orderId: string;
}

export async function executeTrade(params: TradeParams): Promise<TradeResult> {
    return withLock(_openLocks, params.wallet, () => _executeTrade(params));
}

async function _executeTrade(params: TradeParams): Promise<TradeResult> {
    const { wallet, conditionId, outcome, amount, leverage } = params;
    console.log(`[trade] START wallet=${wallet} condition=${conditionId} outcome=${outcome} amount=${amount} leverage=${leverage}x`);

    /* --- 1. Fetch market --- */
    const market = await Market.findOne({ conditionId }).lean();
    if (!market) throw new Error("Market not found");

    const isYes = outcome === "Yes";
    const yesTokenId = market.tokens.Yes.tokenId;
    const noTokenId = market.tokens.No.tokenId;
    const primaryTokenId = isYes ? yesTokenId : noTokenId;

    /* --- 2. CLOB data --- */
    const midpoint = await fetchMidpoint(primaryTokenId);
    if (midpoint <= 0 || midpoint >= 1) throw new Error("Invalid midpoint price");
    if (midpoint < 0.10 || midpoint > 0.90) {
        throw new Error(
            `Trading disabled: midpoint $${midpoint.toFixed(4)} outside 10%-90% range`,
        );
    }

    let price: number;
    try {
        const best = await fetchBestPrice(primaryTokenId, "BUY");
        const deviation = Math.abs(best - midpoint) / midpoint;
        if (deviation > 0.15) {
            console.warn(`[trade] bestPrice ($${best.toFixed(4)}) deviates ${(deviation * 100).toFixed(0)}% from midpoint ($${midpoint.toFixed(4)}), using midpoint`);
            price = midpoint;
        } else {
            price = best;
        }
    } catch {
        console.warn(`[trade] fetchBestPrice failed, using midpoint ($${midpoint.toFixed(4)})`);
        price = midpoint;
    }

    const shares = Math.floor((amount / price) * USDC_SCALE) / USDC_SCALE;

    /* --- 3. Compute margin & borrow amounts (2x cost for YES+NO hedge) --- */
    const amountMicro = toMicro(amount);
    const hedgeCost = amountMicro * 2n;
    const marginMicro = toMicro(amount / leverage);
    const borrowedMicro = hedgeCost - marginMicro;
    const totalSettlement = hedgeCost;

    const liqPrice = isYes
        ? price * (1 - 1 / leverage)
        : Math.min(1, price * (1 + 1 / leverage));

    console.log(`[trade] === TRADE PLAN (HEDGED) ===`);
    console.log(`[trade]   Market:       "${market.question}"`);
    console.log(`[trade]   Side:         ${outcome} @ $${price.toFixed(4)}`);
    console.log(`[trade]   User amount:  ${usd(amountMicro)}`);
    console.log(`[trade]   Hedge cost:   ${usd(hedgeCost)} (YES + NO)`);
    console.log(`[trade]   User margin:  ${usd(marginMicro)} (from Vault)`);
    console.log(`[trade]   LP borrow:    ${usd(borrowedMicro)} (from LPPool)`);
    console.log(`[trade]   Leverage:     ${leverage}x`);
    console.log(`[trade]   Shares:       ${shares}`);
    console.log(`[trade]   Liq price:    $${liqPrice.toFixed(4)}`);

    /* --- 4. Reconcile & validate margin --- */
    resetNonce();
    clearMarginCache(wallet);
    try {
        const rc = await reconcileWallet(wallet);
        if (rc.status === "recovered") {
            console.log(`[trade] Auto-reconcile released ${usd(rc.excessReleased)} zombie-locked margin`);
        }
    } catch (err: any) {
        console.warn(`[trade] Auto-reconcile failed (non-fatal): ${err.message?.slice(0, 100)}`);
    }

    clearMarginCache(wallet);
    const margin = await getUserMargin(wallet);
    const availableMicro = BigInt(margin.available);

    console.log(`[trade] === BALANCES BEFORE ===`);
    console.log(`[trade]   Vault margin: available=${usd(margin.available)} locked=${usd(margin.locked)} total=${usd(margin.total)}`);

    if (availableMicro < marginMicro) {
        throw new Error(
            `Insufficient margin: need ${usd(marginMicro)}, available ${usd(availableMicro)}`,
        );
    }

    /* --- 5. Validate LP pool liquidity --- */
    const poolStats = await getPoolStats(conditionId);
    const poolLiquidity = usd(poolStats.availableLiquidity);
    console.log(`[trade]   LP pool:      available=${poolLiquidity}`);
    if (BigInt(poolStats.availableLiquidity) < borrowedMicro) {
        throw new Error(`Insufficient LP pool liquidity: need ${usd(borrowedMicro)}, available ${poolLiquidity}`);
    }

    /* --- 6. Decide path & place orders --- */
    const [negRisk, tickSize] = await Promise.all([
        fetchNegRisk(primaryTokenId),
        fetchTickSize(primaryTokenId),
    ]);
    const tickDecimals = Math.max(1, -Math.log10(parseFloat(tickSize)));
    const primaryOrderPrice = applySlippage(price, tickDecimals);
    const oppositePrice = roundTick(1 - price, tickDecimals);
    const oppositeOrderPrice = applySlippage(oppositePrice, tickDecimals);
    const polyBalance = await getPolymarketWalletBalance();
    const isOptimistic = polyBalance >= hedgeCost;

    console.log(`[trade]   Poly wallet:  ${usd(polyBalance)} (USDC.e)`);

    if (isOptimistic) {
        console.log(`[trade] === PATH: OPTIMISTIC ===`);
        console.log(`[trade]   Poly wallet (${usd(polyBalance)}) >= hedge cost (${usd(hedgeCost)})`);
    } else {
        console.log(`[trade] === PATH: SETTLEMENT-FIRST ===`);
        console.log(`[trade]   Poly wallet (${usd(polyBalance)}) < hedge cost (${usd(hedgeCost)})`);
    }

    await ensureExchangeApproval();

    let orderId: string;

    if (isOptimistic) {
        console.log("[trade] Placing HEDGED CLOB orders (primary FOK + opposite GTC)...");
        const [primaryResult, oppositeResult] = await Promise.all([
            placeMarketOrder({ tokenId: primaryTokenId, price: primaryOrderPrice, amount, side: 0, negRisk, tickSize, orderType: "FOK" }),
            placeMarketOrder({ tokenId: isYes ? noTokenId : yesTokenId, price: oppositeOrderPrice, amount, side: 0, negRisk, tickSize, orderType: "GTC" }),
        ]);
        orderId = primaryResult.orderID;
        console.log(`[trade] Primary order: ${orderId}`);
        console.log(`[trade] Hedge order:   ${oppositeResult.orderID} (GTC)`);

        const key = settlementKey(wallet, conditionId);
        const settlePromise = settle(wallet, conditionId, marginMicro, borrowedMicro, totalSettlement)
            .catch((err) => console.error("[trade] Background settlement failed:", err))
            .finally(() => _pendingSettlements.delete(key));
        _pendingSettlements.set(key, settlePromise);
    } else {
        const steps = 5;
        let step = 0;
        let marginLocked = false;
        let lpBorrowed = false;

        try {
            step++;
            broadcastTradeProgress(wallet, { step, total: steps, label: "Locking margin..." });
            console.log(`[trade] [${step}/${steps}] Lock margin: ${usd(marginMicro)} from user vault`);
            await lockMargin(wallet, marginMicro.toString());
            marginLocked = true;

            step++;
            broadcastTradeProgress(wallet, { step, total: steps, label: "Borrowing from LP..." });
            console.log(`[trade] [${step}/${steps}] Borrow LP: ${usd(borrowedMicro)} from LPPool`);
            await borrowFromPool(conditionId, borrowedMicro.toString());
            lpBorrowed = true;

            step++;
            broadcastTradeProgress(wallet, { step, total: steps, label: "Funding wallet..." });
            console.log(`[trade] [${step}/${steps}] Fund poly: ${usd(totalSettlement)} Vault -> Polymarket wallet`);
            await fundPolymarketWallet(totalSettlement.toString());

            step++;
            broadcastTradeProgress(wallet, { step, total: steps, label: "Swapping USDC..." });
            console.log(`[trade] [${step}/${steps}] Swap: ${usd(totalSettlement)} native USDC -> USDC.e`);
            await swapNativeUsdcToUsdcE(totalSettlement);
            await ensureExchangeApproval();

            step++;
            broadcastTradeProgress(wallet, { step, total: steps, label: "Placing orders..." });
            console.log("[trade] Placing HEDGED CLOB orders (primary FOK + opposite GTC)...");
            const [primaryResult, oppositeResult] = await Promise.all([
                placeMarketOrder({ tokenId: primaryTokenId, price: primaryOrderPrice, amount, side: 0, negRisk, tickSize, orderType: "FOK" }),
                placeMarketOrder({ tokenId: isYes ? noTokenId : yesTokenId, price: oppositeOrderPrice, amount, side: 0, negRisk, tickSize, orderType: "GTC" }),
            ]);
            orderId = primaryResult.orderID;
            console.log(`[trade] Primary order: ${orderId}`);
            console.log(`[trade] Hedge order:   ${oppositeResult.orderID} (GTC)`);
        } catch (err) {
            console.error("[trade] Settlement-first path FAILED at step", step, err);
            broadcastTradeProgress(wallet, { step, total: steps, label: "Rolling back..." });
            await rollback(
                wallet,
                conditionId,
                marginLocked ? marginMicro : 0n,
                lpBorrowed ? borrowedMicro : 0n,
            );
            throw err;
        }
    }

    /* --- 7. Save position --- */
    const position = await Position.create({
        wallet,
        conditionId,
        outcome,
        leverage: leverage.toString(),
        shares,
        entryPrice: price,
        positionValue: amount,
        marginAmount: Number(marginMicro) / USDC_SCALE,
        borrowedAmount: Number(borrowedMicro) / USDC_SCALE,
        liqPrice,
        status: "open",
        settled: !isOptimistic,
        question: market.question,
        slug: market.slug,
        orderId,
    });

    console.log(`[trade] === TRADE COMPLETE ===`);
    console.log(`[trade]   Market:    "${market.question}"`);
    console.log(`[trade]   Side:      ${outcome} @ $${price.toFixed(4)}`);
    console.log(`[trade]   Shares:    ${shares}`);
    console.log(`[trade]   Margin:    ${usd(marginMicro)} (from Vault)`);
    console.log(`[trade]   Borrowed:  ${usd(borrowedMicro)} (from LPPool)`);
    console.log(`[trade]   Hedge:     ${usd(hedgeCost)} (YES+NO)`);
    console.log(`[trade]   Liq price: $${liqPrice.toFixed(4)}`);
    console.log(`[trade]   Path:      ${isOptimistic ? "optimistic" : "settlement-first"}`);
    console.log(`[trade]   OrderId:   ${orderId}`);

    broadcastPositionUpdate(wallet).catch(() => {});
    return { position, orderId };
}

/* ---------- Background settlement (optimistic path) ---------- */

async function settle(
    wallet: string,
    conditionId: string,
    marginMicro: bigint,
    borrowedMicro: bigint,
    totalSettlement: bigint,
): Promise<void> {
    console.log(`[trade] === BACKGROUND SETTLEMENT START (wallet=${wallet.slice(0, 10)}...) ===`);

    let step = 0;
    let marginLocked = false;
    let lpBorrowed = false;

    try {
        step++;
        console.log(`[trade] [${step}/4] Lock margin: ${usd(marginMicro)} from user vault`);
        await lockMargin(wallet, marginMicro.toString());
        marginLocked = true;

        step++;
        console.log(`[trade] [${step}/4] Borrow LP: ${usd(borrowedMicro)} from LPPool`);
        await borrowFromPool(conditionId, borrowedMicro.toString());
        lpBorrowed = true;

        step++;
        console.log(`[trade] [${step}/4] Fund poly: ${usd(totalSettlement)} Vault -> Polymarket wallet`);
        await fundPolymarketWallet(totalSettlement.toString());

        step++;
        console.log(`[trade] [${step}/4] Swap: ${usd(totalSettlement)} native USDC -> USDC.e`);
        await swapNativeUsdcToUsdcE(totalSettlement);
        await ensureExchangeApproval();

        await Position.updateOne(
            { wallet, conditionId, settled: false, status: "open" },
            { $set: { settled: true } },
        );

        console.log(`[trade] === BACKGROUND SETTLEMENT DONE ===`);
    } catch (err) {
        console.error(`[trade] Background settlement FAILED at step ${step}, rolling back...`, err);
        await rollback(
            wallet,
            conditionId,
            marginLocked ? marginMicro : 0n,
            lpBorrowed ? borrowedMicro : 0n,
        );
        throw err;
    }
}

/* ---------- Close position ---------- */

export async function closePosition(positionId: string, wallet: string) {
    return withLock(_closeLocks, wallet, () => _closePosition(positionId, wallet));
}

async function _closePosition(positionId: string, wallet: string) {
    console.log(`[trade] === CLOSE POSITION ===`);
    console.log(`[trade]   positionId: ${positionId}`);
    console.log(`[trade]   wallet:     ${wallet}`);

    const position = await Position.findOne({ _id: positionId, wallet, status: "open" });
    if (!position) throw new Error("Position not found or already closed");

    /* --- Await any pending background settlement before proceeding --- */
    const key = settlementKey(wallet, position.conditionId);
    const pendingSettle = _pendingSettlements.get(key);
    if (pendingSettle) {
        console.log(`[trade] Pending background settlement detected, awaiting (30s timeout)...`);
        const timeout = new Promise<void>(r => setTimeout(r, 30_000));
        await Promise.race([pendingSettle, timeout]);
        _pendingSettlements.delete(key);
        console.log(`[trade] Settlement await done`);
    }

    const freshPosition = await Position.findById(positionId).lean();
    const wasSettled = freshPosition?.settled ?? false;
    console.log(`[trade]   settled=${wasSettled} (margin ${wasSettled ? "WAS" : "was NOT"} locked on-chain)`);

    const market = await Market.findOne({ conditionId: position.conditionId }).lean();
    if (!market) throw new Error("Market not found");

    const isYes = position.outcome === "Yes";
    const yesTokenId = market.tokens.Yes.tokenId;
    const noTokenId = market.tokens.No.tokenId;
    const marginMicro = toMicro(position.marginAmount);
    const borrowedMicro = toMicro(position.borrowedAmount);

    console.log(`[trade]   Market:     "${market.question}"`);
    console.log(`[trade]   Side:       ${position.outcome} | shares=${position.shares}`);
    console.log(`[trade]   Margin:     ${usd(marginMicro)} (${wasSettled ? "locked in Vault" : "NOT locked"})`);
    console.log(`[trade]   Borrowed:   ${usd(borrowedMicro)} (${wasSettled ? "from LPPool" : "NOT borrowed"})`);

    /* --- Fetch balances & CLOB data for BOTH sides --- */
    const [yesBal, noBal, negRisk, tickSize] = await Promise.all([
        getConditionalTokenBalance(yesTokenId),
        getConditionalTokenBalance(noTokenId),
        fetchNegRisk(yesTokenId),
        fetchTickSize(yesTokenId),
    ]);
    const tickDec = Math.max(1, -Math.log10(parseFloat(tickSize)));

    console.log(`[trade]   YES tokens: ${yesBal} | NO tokens: ${noBal} | tickSize: ${tickSize}`);

    await ensureExchangeApproval();
    await ensureConditionalTokenApproval();

    const sellPromises: Promise<{ orderID: string }>[] = [];

    if (yesBal > 0) {
        const yesMid = await fetchMidpoint(yesTokenId);
        const yesSellPrice = roundTick(Math.max(0.01, yesMid * (1 - MAX_SLIPPAGE_BPS / 10_000)), tickDec);
        console.log(`[trade] Selling YES: ${yesBal} tokens @ $${yesSellPrice.toFixed(tickDec)}`);
        sellPromises.push(placeMarketOrder({ tokenId: yesTokenId, price: yesSellPrice, amount: yesBal, side: 1, negRisk, tickSize }));
    }

    if (noBal > 0) {
        const noMid = await fetchMidpoint(noTokenId);
        const noSellPrice = roundTick(Math.max(0.01, noMid * (1 - MAX_SLIPPAGE_BPS / 10_000)), tickDec);
        console.log(`[trade] Selling NO:  ${noBal} tokens @ $${noSellPrice.toFixed(tickDec)}`);
        sellPromises.push(placeMarketOrder({ tokenId: noTokenId, price: noSellPrice, amount: noBal, side: 1, negRisk, tickSize }));
    }

    if (sellPromises.length === 0) throw new Error("No conditional tokens to sell");

    const sellResults = await Promise.all(sellPromises);
    sellResults.forEach((r, i) => console.log(`[trade] SELL order #${i + 1}: ${r.orderID}`));

    /* --- Mark closed immediately, settle on-chain in background --- */
    position.status = "closed";
    await position.save();

    console.log(`[trade] === POSITION CLOSED ===`);
    console.log(`[trade]   OrderIds: ${sellResults.map(r => r.orderID).join(", ")}`);

    if (wasSettled) {
        closeSettle(wallet, position.conditionId, marginMicro, borrowedMicro).catch((err) =>
            console.error("[trade] Background close-settlement failed:", err),
        );
    } else {
        console.log(`[trade] Skipping close-settlement (open settlement never completed)`);
    }

    broadcastPositionUpdate(wallet).catch(() => {});
    return position;
}

async function closeSettle(
    wallet: string,
    conditionId: string,
    marginMicro: bigint,
    borrowedMicro: bigint,
): Promise<void> {
    console.log(`[trade] === CLOSE SETTLEMENT START ===`);

    const returnAmount = marginMicro + borrowedMicro;

    /* --- Sweep funds: poly wallet USDC.e → native USDC → vault --- */
    if (returnAmount > 0n) {
        try {
            console.log(`[trade]   Sweeping USDC.e → native USDC (${usd(returnAmount)})...`);
            await swapUsdcEToNativeUsdc(returnAmount);
            console.log(`[trade]   Transferring native USDC → Vault...`);
            await returnFundsToVault(returnAmount);
            console.log(`[trade]   Funds returned to Vault`);
        } catch (err: any) {
            console.error("[trade]   Fund sweep FAILED:", err.message?.slice(0, 120));
        }
    }

    /* --- Release margin (accounting only) --- */
    try {
        if (marginMicro > 0n) {
            console.log(`[trade]   Releasing margin: ${usd(marginMicro)} back to user vault`);
            await releaseMargin(wallet, marginMicro.toString());
            console.log(`[trade]   Margin released`);
        }
    } catch (err: any) {
        console.error("[trade]   releaseMargin on close FAILED:", err.message?.slice(0, 120));
    }

    /* --- Repay LP (needs actual USDC in vault) --- */
    try {
        if (borrowedMicro > 0n) {
            console.log(`[trade]   Repaying LP: ${usd(borrowedMicro)} back to LPPool`);
            await repayToPool(conditionId, borrowedMicro.toString());
            console.log(`[trade]   LP repaid`);
        }
    } catch (err: any) {
        console.error("[trade]   repayToPool on close FAILED:", err.message?.slice(0, 120));
        await Position.updateOne(
            { wallet, conditionId, status: "closed" },
            { $set: { settled: false } },
        ).catch(() => {});
    }

    console.log(`[trade] === CLOSE SETTLEMENT DONE ===`);
}

/* ---------- Rollback (settlement-first path, CLOB failed) ---------- */

async function rollback(
    wallet: string,
    conditionId: string,
    marginMicro: bigint,
    borrowedMicro: bigint,
): Promise<void> {
    console.log(`[trade] === ROLLBACK START ===`);
    console.log(`[trade]   marginToRelease=${marginMicro} borrowToRepay=${borrowedMicro}`);

    if (marginMicro > 0n) {
        try {
            console.log(`[trade]   Releasing margin: ${usd(marginMicro)} back to user vault`);
            await releaseMargin(wallet, marginMicro.toString());
            console.log(`[trade]   Margin released`);
        } catch (err: any) {
            console.error("[trade]   releaseMargin rollback FAILED:", err.message?.slice(0, 120));
        }
    } else {
        console.log(`[trade]   Skipping releaseMargin (nothing was locked)`);
    }

    if (borrowedMicro > 0n) {
        try {
            console.log(`[trade]   Repaying LP: ${usd(borrowedMicro)} back to LPPool`);
            await repayToPool(conditionId, borrowedMicro.toString());
            console.log(`[trade]   LP repaid`);
        } catch (err: any) {
            console.error("[trade]   repayToPool rollback FAILED:", err.message?.slice(0, 120));
        }
    } else {
        console.log(`[trade]   Skipping repayToPool (nothing was borrowed)`);
    }

    console.log(`[trade] === ROLLBACK DONE ===`);
}
