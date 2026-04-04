import { getLPPoolContract } from "../lib/contracts";

export interface PoolStats {
    totalDeposited: string;
    totalBorrowed: string;
    availableLiquidity: string;
    utilizationRateBps: string;
    interestRateBps: string;
    sharePrice: string;
    totalShares: string;
}

export interface LPBalance {
    shares: string;
    usdcValue: string;
}

export async function getPoolStats(conditionId: string): Promise<PoolStats> {
    const pool = getLPPoolContract();

    const [state, utilRate, interestRate, price] = await Promise.all([
        pool.getPoolState(conditionId),
        pool.utilizationRate(conditionId),
        pool.currentInterestRate(conditionId),
        pool.sharePrice(conditionId),
    ]);

    return {
        totalDeposited: state.totalDeposited.toString(),
        totalBorrowed: state.totalBorrowed.toString(),
        availableLiquidity: state.availableLiquidity.toString(),
        utilizationRateBps: utilRate.toString(),
        interestRateBps: interestRate.toString(),
        sharePrice: price.toString(),
        totalShares: state.totalShares.toString(),
    };
}

export async function getLPBalance(conditionId: string, address: string): Promise<LPBalance> {
    const pool = getLPPoolContract();
    const pos = await pool.getUserPosition(conditionId, address);

    return {
        shares: pos.userShares.toString(),
        usdcValue: pos.usdcValue.toString(),
    };
}
