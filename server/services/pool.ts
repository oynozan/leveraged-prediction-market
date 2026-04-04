import { getLPPoolContract } from "../lib/contracts";

export interface PoolStats {
    totalAssets: string;
    totalBorrowed: string;
    availableLiquidity: string;
    utilizationRateBps: string;
    interestRateBps: string;
    sharePrice: string;
    totalSupply: string;
}

export interface LPBalance {
    shares: string;
    usdcValue: string;
}

export async function getPoolStats(): Promise<PoolStats> {
    const pool = getLPPoolContract();

    const [totalAssets, totalBorrowed, availableLiquidity, utilRate, interestRate, totalSupply] =
        await Promise.all([
            pool.totalAssets(),
            pool.totalBorrowed(),
            pool.availableLiquidity(),
            pool.utilizationRate(),
            pool.currentInterestRate(),
            pool.totalSupply(),
        ]);

    const sharePrice =
        totalSupply > 0n
            ? ((totalAssets * 1_000_000n) / totalSupply).toString()
            : "1000000";

    return {
        totalAssets: totalAssets.toString(),
        totalBorrowed: totalBorrowed.toString(),
        availableLiquidity: availableLiquidity.toString(),
        utilizationRateBps: utilRate.toString(),
        interestRateBps: interestRate.toString(),
        sharePrice,
        totalSupply: totalSupply.toString(),
    };
}

export async function getLPBalance(address: string): Promise<LPBalance> {
    const pool = getLPPoolContract();

    const [shares, totalAssets, totalSupply] = await Promise.all([
        pool.balanceOf(address),
        pool.totalAssets(),
        pool.totalSupply(),
    ]);

    const usdcValue =
        totalSupply > 0n ? ((shares * totalAssets) / totalSupply).toString() : "0";

    return {
        shares: shares.toString(),
        usdcValue,
    };
}
