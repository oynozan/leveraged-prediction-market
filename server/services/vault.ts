import { ethers } from "ethers";
import { getVaultContract } from "../lib/contracts";

export interface MarginInfo {
    total: string;
    locked: string;
    available: string;
}

export async function getUserMargin(address: string): Promise<MarginInfo> {
    const vault = getVaultContract();
    const [total, locked, available] = await vault.getMargin(address);

    return {
        total: total.toString(),
        locked: locked.toString(),
        available: available.toString(),
    };
}

export async function lockMargin(user: string, amount: string): Promise<ethers.TransactionReceipt> {
    const vault = getVaultContract();
    const tx = await vault.lockMargin(user, BigInt(amount));
    return tx.wait();
}

export async function releaseMargin(user: string, amount: string): Promise<ethers.TransactionReceipt> {
    const vault = getVaultContract();
    const tx = await vault.releaseMargin(user, BigInt(amount));
    return tx.wait();
}

export async function borrowFromPool(amount: string): Promise<ethers.TransactionReceipt> {
    const vault = getVaultContract();
    const tx = await vault.borrowFromPool(BigInt(amount));
    return tx.wait();
}

export async function repayToPool(amount: string): Promise<ethers.TransactionReceipt> {
    const vault = getVaultContract();
    const tx = await vault.repayToPool(BigInt(amount));
    return tx.wait();
}
