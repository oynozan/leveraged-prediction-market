import { ethers } from "ethers";
import { getProvider } from "./contracts";

const RECEIPT_POLL_INTERVAL = 3_000;
const RECEIPT_TIMEOUT = 120_000;

/**
 * Resilient receipt poller that retries on RPC errors (rate limits, connection drops).
 * Unlike ethers' tx.wait(), individual poll failures don't kill the entire wait.
 */
export async function pollForReceipt(
    txHash: string,
    label: string,
    provider?: ethers.Provider,
): Promise<ethers.TransactionReceipt> {
    const p = provider ?? getProvider();
    const deadline = Date.now() + RECEIPT_TIMEOUT;
    let attempt = 0;

    while (Date.now() < deadline) {
        attempt++;
        try {
            const receipt = await p.getTransactionReceipt(txHash);
            if (receipt) {
                if (receipt.status === 0) {
                    throw new Error(`${label} tx reverted on-chain (${txHash})`);
                }
                return receipt;
            }
        } catch (err: any) {
            if (err.message?.includes("reverted")) throw err;
            console.warn(
                `[tx] ${label} receipt poll #${attempt} failed: ${err.message?.slice(0, 80)}`,
            );
        }
        await new Promise((r) => setTimeout(r, RECEIPT_POLL_INTERVAL));
    }

    throw new Error(
        `${label} tx submitted (${txHash}) but receipt not received within ${RECEIPT_TIMEOUT / 1000}s. Transaction may still confirm on-chain.`,
    );
}
