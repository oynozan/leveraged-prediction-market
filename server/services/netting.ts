import { ethers } from "ethers";
import { getNettingEngineContract } from "../lib/contracts";

export interface NettingState {
    totalYes: string;
    totalNo: string;
    matchedPairs: string;
}

export interface Holdings {
    realYesTokens: string;
    realNoTokens: string;
}

export async function getNettingState(conditionId: string): Promise<NettingState> {
    const engine = getNettingEngineContract();
    const [totalYes, totalNo, matchedPairs] = await engine.getNettingState(conditionId);

    return {
        totalYes: totalYes.toString(),
        totalNo: totalNo.toString(),
        matchedPairs: matchedPairs.toString(),
    };
}

export async function getCurrentHoldings(conditionId: string): Promise<Holdings> {
    const engine = getNettingEngineContract();
    const [realYesTokens, realNoTokens] = await engine.getCurrentHoldings(conditionId);

    return {
        realYesTokens: realYesTokens.toString(),
        realNoTokens: realNoTokens.toString(),
    };
}

export async function openPosition(
    user: string,
    conditionId: string,
    isYes: boolean,
    tokenAmount: string,
): Promise<ethers.TransactionReceipt> {
    const engine = getNettingEngineContract();
    const tx = await engine.openPosition(user, conditionId, isYes, BigInt(tokenAmount));
    return tx.wait();
}

export async function closePosition(
    user: string,
    conditionId: string,
    isYes: boolean,
    tokenAmount: string,
): Promise<ethers.TransactionReceipt> {
    const engine = getNettingEngineContract();
    const tx = await engine.closePosition(user, conditionId, isYes, BigInt(tokenAmount));
    return tx.wait();
}
