import { getLPPoolContract } from "../lib/contracts";
import Market from "../models/Markets";

export interface PoolState {
    conditionId: string;
    question: string;
    slug: string;
    endDate: string;
    totalDeposited: string;
    totalBorrowed: string;
    availableLiquidity: string;
    totalShares: string;
    utilizationBps: string;
    interestRateBps: string;
    sharePrice: string;
}

export interface LPPosition {
    conditionId: string;
    question: string;
    slug: string;
    shares: string;
    currentValue: string;
    poolSharePct: string;
    apyBps: string;
}

export interface UserLPSummary {
    positions: LPPosition[];
    totalCurrentValue: string;
    weightedApyBps: string;
}

const BPS = 10000n;
const SHARE_PRECISION = BigInt(1e18);

interface RateParams {
    baseRate: bigint;
    kinkRate: bigint;
    maxRate: bigint;
    kinkUtilization: bigint;
}

let _rateParams: RateParams | null = null;
let _rateParamsTs = 0;

async function getRateParams(): Promise<RateParams> {
    if (_rateParams && Date.now() - _rateParamsTs < 300_000) return _rateParams;
    const pool = getLPPoolContract();
    const [baseRate, kinkRate, maxRate, kinkUtilization] = await Promise.all([
        pool.baseRate(),
        pool.kinkRate(),
        pool.maxRate(),
        pool.kinkUtilization(),
    ]);
    _rateParams = {
        baseRate: BigInt(baseRate),
        kinkRate: BigInt(kinkRate),
        maxRate: BigInt(maxRate),
        kinkUtilization: BigInt(kinkUtilization),
    };
    _rateParamsTs = Date.now();
    return _rateParams;
}

function computeUtilizationBps(totalDeposited: bigint, totalBorrowed: bigint): bigint {
    if (totalDeposited === 0n) return 0n;
    return (totalBorrowed * BPS) / totalDeposited;
}

function computeInterestRate(utilBps: bigint, params: RateParams): bigint {
    if (utilBps <= params.kinkUtilization) {
        return params.baseRate + ((params.kinkRate - params.baseRate) * utilBps) / params.kinkUtilization;
    }
    return params.kinkRate
        + ((params.maxRate - params.kinkRate) * (utilBps - params.kinkUtilization))
        / (BPS - params.kinkUtilization);
}

function computeSharePrice(totalDeposited: bigint, totalShares: bigint): bigint {
    if (totalShares === 0n) return SHARE_PRECISION;
    return (totalDeposited * SHARE_PRECISION) / totalShares;
}

const POOLS_CACHE_TTL = 30_000; // 30 seconds
let _poolsCache: PoolState[] | null = null;
let _poolsCacheTs = 0;
let _poolsCachePromise: Promise<PoolState[]> | null = null;

function defaultPoolState(
    market: { conditionId: string; question: string; slug: string; endDate: Date },
    rateParams: RateParams,
): PoolState {
    return {
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        endDate: market.endDate.toISOString(),
        totalDeposited: "0",
        totalBorrowed: "0",
        availableLiquidity: "0",
        totalShares: "0",
        utilizationBps: "0",
        interestRateBps: rateParams.baseRate.toString(),
        sharePrice: SHARE_PRECISION.toString(),
    };
}

function buildPoolState(
    market: { conditionId: string; question: string; slug: string; endDate: Date },
    state: { totalDeposited: bigint; totalBorrowed: bigint; availableLiquidity: bigint; totalShares: bigint },
    rateParams: RateParams,
): PoolState {
    const totalDeposited = BigInt(state.totalDeposited);
    const totalBorrowed = BigInt(state.totalBorrowed);
    const totalShares = BigInt(state.totalShares);

    const utilBps = computeUtilizationBps(totalDeposited, totalBorrowed);
    const rateBps = computeInterestRate(utilBps, rateParams);
    const price = computeSharePrice(totalDeposited, totalShares);

    return {
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        endDate: market.endDate.toISOString(),
        totalDeposited: state.totalDeposited.toString(),
        totalBorrowed: state.totalBorrowed.toString(),
        availableLiquidity: state.availableLiquidity.toString(),
        totalShares: state.totalShares.toString(),
        utilizationBps: utilBps.toString(),
        interestRateBps: rateBps.toString(),
        sharePrice: price.toString(),
    };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchAllPoolsFromChain(): Promise<PoolState[]> {
    const pool = getLPPoolContract();
    const markets = await Market.find({}, { __v: 0 }).sort({ syncedAt: -1 }).lean();
    if (markets.length === 0) return [];

    let rateParams: RateParams;
    try {
        rateParams = await getRateParams();
    } catch {
        return markets.map(m => defaultPoolState(m, {
            baseRate: 200n, kinkRate: 2000n, maxRate: 10000n, kinkUtilization: 8000n,
        }));
    }

    const results: PoolState[] = [];

    for (const market of markets) {
        try {
            const state = await pool.getPoolState(market.conditionId);
            results.push(buildPoolState(market, state, rateParams));
        } catch {
            results.push(defaultPoolState(market, rateParams));
        }
        await sleep(150);
    }

    return results;
}

export async function getAllPools(): Promise<PoolState[]> {
    // Return cached data if fresh
    if (_poolsCache && Date.now() - _poolsCacheTs < POOLS_CACHE_TTL) {
        return _poolsCache;
    }

    if (!_poolsCachePromise) {
        _poolsCachePromise = fetchAllPoolsFromChain()
            .then(pools => {
                _poolsCache = pools;
                _poolsCacheTs = Date.now();
                _poolsCachePromise = null;
                return pools;
            })
            .catch(err => {
                _poolsCachePromise = null;
                // Return stale cache if available
                if (_poolsCache) return _poolsCache;
                throw err;
            });
    }

    return _poolsCachePromise;
}

export async function getPoolState(conditionId: string): Promise<PoolState | null> {
    const pools = await getAllPools();
    return pools.find(p => p.conditionId === conditionId) ?? null;
}

export async function getUserPositions(address: string): Promise<UserLPSummary> {
    // Reuse the cached pool data instead of making new RPC calls
    const pools = await getAllPools();
    if (pools.length === 0) {
        return { positions: [], totalCurrentValue: "0", weightedApyBps: "0" };
    }

    const pool = getLPPoolContract();
    let rateParams: RateParams;
    try {
        rateParams = await getRateParams();
    } catch {
        return { positions: [], totalCurrentValue: "0", weightedApyBps: "0" };
    }

    const positions: LPPosition[] = [];
    let totalValue = 0n;
    let weightedRateSum = 0n;

    for (const poolState of pools) {
        try {
            const pos = await pool.getUserPosition(poolState.conditionId, address);

            const userShares: bigint = pos.userShares;
            const usdcValue: bigint = pos.usdcValue;

            if (userShares === 0n) { await sleep(100); continue; }

            const totalSharesBig = BigInt(poolState.totalShares);
            const utilBps = BigInt(poolState.utilizationBps);
            const rateBps = computeInterestRate(utilBps, rateParams);

            const poolSharePct =
                totalSharesBig > 0n
                    ? ((userShares * 10000n) / totalSharesBig).toString()
                    : "0";

            positions.push({
                conditionId: poolState.conditionId,
                question: poolState.question,
                slug: poolState.slug,
                shares: userShares.toString(),
                currentValue: usdcValue.toString(),
                poolSharePct,
                apyBps: rateBps.toString(),
            });

            totalValue += usdcValue;
            weightedRateSum += usdcValue * rateBps;
        } catch {
            // skip
        }
        await sleep(150);
    }

    const weightedApyBps =
        totalValue > 0n ? (weightedRateSum / totalValue).toString() : "0";

    return {
        positions,
        totalCurrentValue: totalValue.toString(),
        weightedApyBps,
    };
}

