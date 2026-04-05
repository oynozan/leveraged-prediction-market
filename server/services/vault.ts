import { ethers } from "ethers";
import { getVaultContract, resetNonce } from "../lib/contracts";
import { pollForReceipt } from "../lib/tx-utils";
import { broadcastMarginUpdate } from "../socket/broadcast";

function isNonceError(err: any): boolean {
    const msg = String(err?.message ?? "") + String(err?.shortMessage ?? "");
    return (
        msg.includes("REPLACEMENT_UNDERPRICED") ||
        msg.includes("replacement transaction underpriced") ||
        msg.includes("replacement fee too low") ||
        msg.includes("NONCE_EXPIRED") ||
        msg.includes("nonce has already been used") ||
        msg.includes("nonce too low")
    );
}

async function sendTx<T>(
    label: string,
    fn: () => Promise<ethers.TransactionResponse>,
): Promise<ethers.TransactionReceipt> {
    let tx: ethers.TransactionResponse;
    try {
        tx = await fn();
    } catch (err: any) {
        if (isNonceError(err)) {
            console.warn(`[vault] ${label} hit nonce error, resetting and retrying...`);
            resetNonce();
            await new Promise((r) => setTimeout(r, 2_000));
            tx = await fn();
        } else {
            throw err;
        }
    }
    console.log(`[vault] ${label} tx=${tx.hash}`);
    let receipt: ethers.TransactionReceipt;
    try {
        const r = await tx.wait();
        if (!r) throw new Error("null receipt from tx.wait()");
        if (r.status === 0) throw new Error(`${label} tx reverted on-chain (${tx.hash})`);
        receipt = r;
    } catch (err: any) {
        if (err.message?.includes("reverted")) throw err;
        console.warn(`[vault] ${label} tx.wait() failed, falling back to pollForReceipt: ${err.message?.slice(0, 80)}`);
        receipt = await pollForReceipt(tx.hash, label);
    }
    console.log(`[vault] ${label} confirmed block=${receipt.blockNumber}`);
    return receipt;
}

export interface MarginInfo {
    total: string;
    locked: string;
    available: string;
}

const MARGIN_CACHE_TTL = 10_000;
const _marginCache = new Map<string, { data: MarginInfo; ts: number }>();

export function clearMarginCache(address?: string): void {
    if (address) {
        _marginCache.delete(address);
    } else {
        _marginCache.clear();
    }
}

export async function getUserMargin(address: string): Promise<MarginInfo> {
    const cached = _marginCache.get(address);
    if (cached && Date.now() - cached.ts < MARGIN_CACHE_TTL) return cached.data;

    const vault = getVaultContract();
    if (!vault) {
        return { total: "0", locked: "0", available: "0" };
    }
    const [total, locked, available] = await vault.getMargin(address);

    const data: MarginInfo = {
        total: total.toString(),
        locked: locked.toString(),
        available: available.toString(),
    };
    _marginCache.set(address, { data, ts: Date.now() });
    return data;
}

export async function lockMargin(user: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] lockMargin user=${user} amount=${amount}`);
    const vault = getVaultContract();
    const receipt = await sendTx("lockMargin", () => vault.lockMargin(user, BigInt(amount)));
    _marginCache.delete(user);
    broadcastMarginUpdate(user).catch(() => {});
    return receipt;
}

export async function releaseMargin(user: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] releaseMargin user=${user} amount=${amount}`);
    const vault = getVaultContract();
    const receipt = await sendTx("releaseMargin", () => vault.releaseMargin(user, BigInt(amount)));
    _marginCache.delete(user);
    broadcastMarginUpdate(user).catch(() => {});
    return receipt;
}

export async function borrowFromPool(conditionId: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] borrowFromPool conditionId=${conditionId} amount=${amount}`);
    const vault = getVaultContract();
    return sendTx("borrowFromPool", () => vault.borrowFromPool(conditionId, BigInt(amount)));
}

export async function repayToPool(conditionId: string, amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] repayToPool conditionId=${conditionId} amount=${amount}`);
    const vault = getVaultContract();
    return sendTx("repayToPool", () => vault.repayToPool(conditionId, BigInt(amount)));
}

export async function fundPolymarketWallet(amount: string): Promise<ethers.TransactionReceipt> {
    console.log(`[vault] fundPolymarketWallet amount=${amount}`);
    const vault = getVaultContract();
    return sendTx("fundPolymarketWallet", () => vault.fundPolymarketWallet(BigInt(amount)));
}
