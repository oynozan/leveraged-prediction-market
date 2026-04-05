"use client";

import { useState, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
    createPublicClient,
    createWalletClient,
    custom,
    parseUnits,
    formatUnits,
    type Address,
} from "viem";
import { polygon } from "viem/chains";
import { cn } from "@/lib/utils";
import { getDepositConfig, getMarginBalance } from "@/lib/api";
import type { DepositConfig, MarginInfo } from "@/lib/types";
import { toast } from "sonner";

const log = (...args: unknown[]) => console.log("[withdraw]", ...args);

const VAULT_WITHDRAW_ABI = [
    { name: "withdrawMargin", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

type Step = "idle" | "withdrawing" | "done" | "error";

export default function WithdrawPage() {
    const { ready, authenticated, login } = usePrivy();
    const { wallets } = useWallets();
    const wallet = wallets[0];

    const [config, setConfig] = useState<DepositConfig | null>(null);
    const [margin, setMargin] = useState<MarginInfo | null>(null);
    const [amount, setAmount] = useState("");
    const [step, setStep] = useState<Step>("idle");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    useEffect(() => {
        getDepositConfig()
            .then(c => setConfig(c))
            .catch(err => log("Config error:", err));
    }, []);

    const loadMargin = () => {
        if (!wallet?.address) return;
        getMarginBalance(wallet.address)
            .then(m => setMargin(m))
            .catch(err => log("Margin error:", err));
    };

    useEffect(() => {
        if (step !== "idle" && step !== "done") return;
        loadMargin();
    }, [wallet?.address, step]);

    const withdrawParsed = (() => {
        if (!amount) return BigInt(0);
        try { return parseUnits(amount, 6); } catch { return BigInt(0); }
    })();

    const availableMargin = margin ? BigInt(margin.available) : BigInt(0);
    const isBusy = step === "withdrawing";
    const canSubmit = withdrawParsed > BigInt(0) && withdrawParsed <= availableMargin && !isBusy && step !== "done";

    async function handleWithdraw() {
        if (!wallet?.address || !config?.vaultAddress || !amount) return;

        const withdrawAmount = parseUnits(amount, 6);
        if (withdrawAmount <= BigInt(0)) return;

        log("=== WITHDRAW START ===");
        log("Amount:", amount, "raw:", withdrawAmount.toString());
        log("Vault:", config.vaultAddress);

        setError(null);
        setStep("withdrawing");

        try {
            try {
                await wallet.switchChain(137);
            } catch (err) {
                log("Failed to switch chain:", err);
            }

            const provider = await wallet.getEthereumProvider();
            const transport = custom(provider);
            const walletClient = createWalletClient({ chain: polygon, transport, account: wallet.address as Address });
            const publicClient = createPublicClient({ chain: polygon, transport });

            log("Calling withdrawMargin...");
            const tx = await walletClient.writeContract({
                address: config.vaultAddress as Address,
                abi: VAULT_WITHDRAW_ABI,
                functionName: "withdrawMargin",
                args: [withdrawAmount],
            });
            log("Withdraw tx sent:", tx);

            const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
            log("Withdraw confirmed, status:", receipt.status);

            setTxHash(tx);
            setStep("done");
            setAmount("");
            loadMargin();
            window.dispatchEvent(new Event("balance:update"));
            toast.success("Withdrawal successful!");
            log("=== WITHDRAW DONE ===");
        } catch (err: any) {
            log("=== WITHDRAW FAILED ===", err);
            const msg = err.shortMessage || err.message || "Withdrawal failed";
            setError(msg);
            setStep("error");
            toast.error(msg);
        }
    }

    if (!ready) return <div className="flex-1 bg-background" />;

    if (!authenticated) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background">
                <div className="text-center space-y-4">
                    <h1 className="text-xl font-semibold text-foreground">Connect wallet to withdraw</h1>
                    <button onClick={login} className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
                        Connect Wallet
                    </button>
                </div>
            </div>
        );
    }

    const fmtAvailable = margin
        ? Number(formatUnits(BigInt(margin.available), 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "0.00";

    return (
        <div className="flex-1 flex items-start justify-center bg-background pt-12 px-4 pb-12">
            <div className="w-full max-w-md space-y-5">
                <h1 className="text-lg font-semibold text-foreground">Withdraw</h1>

                {margin && (
                    <div className="grid grid-cols-3 gap-3">
                        {([
                            ["Total", margin.total],
                            ["Locked", margin.locked],
                            ["Available", margin.available],
                        ] as const).map(([label, raw]) => (
                            <div key={label} className="bg-card rounded-lg border border-border px-3 py-2.5">
                                <div className="text-[10px] text-muted-foreground">{label}</div>
                                <div className="text-sm font-medium text-foreground mt-0.5">
                                    ${Number(formatUnits(BigInt(raw), 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">Amount (USDC)</label>
                        {margin && (
                            <button
                                onClick={() => setAmount(formatUnits(BigInt(margin.available), 6))}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Max: ${fmtAvailable}
                            </button>
                        )}
                    </div>
                    <div className="relative">
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amount}
                            disabled={isBusy}
                            onChange={e => {
                                const v = e.target.value.replace(/[^0-9.]/g, "");
                                if (v.split(".").length <= 2) setAmount(v);
                            }}
                            className={cn(
                                "w-full bg-card border border-border rounded-lg px-4 py-3 text-foreground text-lg outline-none focus:border-primary/50 transition-colors pr-16",
                                isBusy && "opacity-50",
                            )}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            USDC
                        </span>
                    </div>
                    {withdrawParsed > BigInt(0) && withdrawParsed > availableMargin && (
                        <p className="text-xs text-destructive mt-1">Exceeds available margin</p>
                    )}
                </div>

                {error && (
                    <div className="bg-loss/10 border border-loss/20 rounded-lg p-3 text-xs text-loss">
                        {error}
                    </div>
                )}

                {step === "done" && txHash && (
                    <div className="bg-success/10 border border-success/20 rounded-lg p-3 text-xs text-success space-y-1">
                        <div>Withdrawal successful!</div>
                        <a
                            href={`https://polygonscan.com/tx/${txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                        >
                            View on Polygonscan
                        </a>
                    </div>
                )}

                <button
                    onClick={handleWithdraw}
                    disabled={!canSubmit}
                    className={cn(
                        "w-full py-3 text-sm font-medium rounded-lg transition-colors",
                        canSubmit
                            ? "bg-loss text-white hover:bg-loss/90"
                            : "bg-card text-muted-foreground cursor-not-allowed",
                    )}
                >
                    {step === "withdrawing" && "Withdrawing..."}
                    {step === "done" && "Done"}
                    {(step === "idle" || step === "error") && "Withdraw USDC"}
                </button>

                <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                    USDC will be withdrawn from the Vault to your connected wallet on Polygon.
                </p>
            </div>
        </div>
    );
}
