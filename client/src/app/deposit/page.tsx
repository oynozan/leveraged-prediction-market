"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
    createPublicClient,
    createWalletClient,
    custom,
    http,
    parseUnits,
    formatUnits,
    type Address,
    type Chain,
} from "viem";
import { polygon, mainnet, bsc, arbitrum } from "viem/chains";
import { cn } from "@/lib/utils";
import {
    getDepositConfig,
    getMarginBalance,
    getBridgeQuote,
    getBridgeTxData,
    getBridgeStatus,
} from "@/lib/api";
import type { DepositConfig, MarginInfo, BridgeRoute } from "@/lib/types";

const log = (...args: unknown[]) => console.log("[deposit]", ...args);

const CHAIN_MAP: Record<number, Chain> = {
    1: mainnet,
    56: bsc,
    42161: arbitrum,
    137: polygon,
};

const CHAIN_LABELS: Record<number, string> = {
    1: "ETH",
    56: "BSC",
    42161: "ARB",
    137: "POL",
};

const ERC20_ABI = [
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
    { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
    { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const VAULT_DEPOSIT_ABI = [
    { name: "depositMargin", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
    { name: "depositWithSwap", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tokenIn", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "poolFee", type: "uint24" }], outputs: [] },
] as const;

type Step =
    | "idle"
    | "quoting"
    | "approving"
    | "depositing"
    | "bridging"
    | "bridge-waiting"
    | "vault-depositing"
    | "done"
    | "error";

export default function DepositPage() {
    const { ready, authenticated, login } = usePrivy();
    const { wallets } = useWallets();
    const wallet = wallets[0];

    const [config, setConfig] = useState<DepositConfig | null>(null);
    const [margin, setMargin] = useState<MarginInfo | null>(null);
    const [selectedChainId, setSelectedChainId] = useState(137);
    const [selectedSymbol, setSelectedSymbol] = useState<"USDC" | "USDT">("USDC");
    const [amount, setAmount] = useState("");
    const [balance, setBalance] = useState<string | null>(null);
    const [step, setStep] = useState<Step>("idle");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    const [bridgeRoute, setBridgeRoute] = useState<BridgeRoute | null>(null);
    const [bridgeEstimate, setBridgeEstimate] = useState<string | null>(null);
    const [bridgeFee, setBridgeFee] = useState<number | null>(null);

    // Bridge polling state
    const [bridgeElapsed, setBridgeElapsed] = useState(0);
    const bridgePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const bridgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const selectedChain = config?.chains.find(c => c.id === selectedChainId);
    const selectedToken = selectedChain?.tokens.find(t => t.symbol === selectedSymbol);
    const isPolygon = selectedChainId === 137;

    useEffect(() => {
        log("Loading deposit config...");
        getDepositConfig()
            .then(c => { log("Config loaded:", c); setConfig(c); })
            .catch(err => { log("Config error:", err); });
    }, []);

    useEffect(() => {
        if (!wallet?.address) return;
        log("Loading margin for", wallet.address);
        getMarginBalance(wallet.address)
            .then(m => { log("Margin:", m); setMargin(m); })
            .catch(err => { log("Margin error:", err); });
    }, [wallet?.address, step]);

    const loadBalance = useCallback(async () => {
        if (!wallet?.address || !selectedToken) { setBalance(null); return; }

        try {
            const chain = CHAIN_MAP[selectedChainId];
            if (!chain) { log("No chain mapping for", selectedChainId); return; }

            log("Reading balance:", { chain: selectedChainId, token: selectedToken.address, wallet: wallet.address, decimals: selectedToken.decimals });
            const publicClient = createPublicClient({ chain, transport: http() });
            const raw = await publicClient.readContract({
                address: selectedToken.address as Address,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [wallet.address as Address],
            });
            const formatted = formatUnits(raw as bigint, selectedToken.decimals);
            log("Balance:", formatted, selectedSymbol);
            setBalance(formatted);
        } catch (err) {
            log("Balance read error:", err);
            setBalance(null);
        }
    }, [wallet?.address, selectedChainId, selectedToken, selectedSymbol]);

    useEffect(() => { loadBalance(); }, [loadBalance]);

    useEffect(() => {
        setAmount("");
        setBridgeRoute(null);
        setBridgeEstimate(null);
        setBridgeFee(null);
        setError(null);
        setStep("idle");
        setTxHash(null);
    }, [selectedChainId, selectedSymbol]);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (bridgePollRef.current) clearInterval(bridgePollRef.current);
            if (bridgeTimerRef.current) clearInterval(bridgeTimerRef.current);
        };
    }, []);

    const parsedAmount = (() => {
        if (!amount || !selectedToken) return 0n;
        try { return parseUnits(amount, selectedToken.decimals); } catch { return 0n; }
    })();

    const fetchBridgeQuote = useCallback(async () => {
        if (isPolygon || !wallet?.address || !selectedToken || parsedAmount === 0n) return;

        log("Fetching bridge quote:", {
            fromChainId: selectedChainId,
            fromToken: selectedToken.address,
            fromAmount: parsedAmount.toString(),
            user: wallet.address,
        });

        setStep("quoting");
        setError(null);
        try {
            const quote = await getBridgeQuote({
                fromChainId: selectedChainId,
                fromTokenAddress: selectedToken.address,
                fromAmount: parsedAmount.toString(),
                userAddress: wallet.address,
            });
            log("Bridge quote response:", quote);

            if (quote.routes.length === 0) {
                log("No bridge routes found");
                setError("No bridge route found for this pair");
                setStep("idle");
                return;
            }
            const best = quote.routes[0];
            log("Selected route:", {
                bridge: best.usedBridgeNames,
                toAmount: best.toAmount,
                fee: best.totalGasFeesInUsd,
                approvalAddress: best.approvalAddress,
                fromTokenAddress: best.fromTokenAddress,
                hasTransactionRequest: !!best.transactionRequest,
            });
            setBridgeRoute(best);
            setBridgeEstimate(formatUnits(BigInt(best.toAmount), 6));
            setBridgeFee(best.totalGasFeesInUsd);
            setStep("idle");
        } catch (err: any) {
            log("Bridge quote error:", err);
            setError(err.message || "Failed to get bridge quote");
            setStep("idle");
        }
    }, [isPolygon, wallet?.address, selectedToken, parsedAmount, selectedChainId]);

    useEffect(() => {
        if (!isPolygon && parsedAmount > 0n) {
            const t = setTimeout(fetchBridgeQuote, 800);
            return () => clearTimeout(t);
        }
        setBridgeRoute(null);
        setBridgeEstimate(null);
        setBridgeFee(null);
    }, [fetchBridgeQuote, isPolygon, parsedAmount]);

    async function switchToChain(chainId: number) {
        if (!wallet) return;
        try {
            log("Switching wallet to chain", chainId);
            await wallet.switchChain(chainId);
            log("Chain switched to", chainId);
        } catch (err) {
            log("Failed to switch chain:", err);
        }
    }

    async function depositToVault(usdcAmount: bigint) {
        if (!wallet?.address || !config?.vaultAddress) return;

        log("=== VAULT DEPOSIT START ===");
        log("USDC amount:", usdcAmount.toString());
        log("Vault:", config.vaultAddress);

        setStep("vault-depositing");

        try {
            await switchToChain(137);
            const provider = await wallet.getEthereumProvider();
            const transport = custom(provider);
            const walletClient = createWalletClient({ chain: polygon, transport, account: wallet.address as Address });
            const publicClient = createPublicClient({ chain: polygon, transport });

            const usdcAddress = (config as DepositConfig).usdcAddress as Address;
            const vaultAddress = config.vaultAddress as Address;

            log("Checking USDC allowance for vault...");
            const allowance = await publicClient.readContract({
                address: usdcAddress,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [wallet.address as Address, vaultAddress],
            }) as bigint;

            log("Allowance:", allowance.toString(), "needed:", usdcAmount.toString());

            if (allowance < usdcAmount) {
                log("Approving USDC to vault (max approval)...");
                const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
                const approveTx = await walletClient.writeContract({
                    address: usdcAddress,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    args: [vaultAddress, MAX_UINT256],
                });
                log("Approve tx sent:", approveTx);
                await publicClient.waitForTransactionReceipt({ hash: approveTx });
                log("Approve confirmed");
            }

            log("Calling depositMargin...");
            const depositTx = await walletClient.writeContract({
                address: vaultAddress,
                abi: VAULT_DEPOSIT_ABI,
                functionName: "depositMargin",
                args: [usdcAmount],
            });
            log("Deposit tx sent:", depositTx);

            const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
            log("Deposit confirmed, status:", receipt.status);

            setTxHash(depositTx);
            setStep("done");
            setAmount("");
            loadBalance();
            log("=== VAULT DEPOSIT DONE ===");
        } catch (err: any) {
            log("=== VAULT DEPOSIT FAILED ===", err);
            setError(err.shortMessage || err.message || "Vault deposit failed");
            setStep("error");
        }
    }

    function startBridgePolling(sourceTxHash: string, fromChainId: number, bridgeName: string) {
        log("Starting bridge status polling for", sourceTxHash);
        setBridgeElapsed(0);

        if (bridgePollRef.current) clearInterval(bridgePollRef.current);
        if (bridgeTimerRef.current) clearInterval(bridgeTimerRef.current);

        bridgeTimerRef.current = setInterval(() => {
            setBridgeElapsed(prev => prev + 1);
        }, 1000);

        const poll = async () => {
            try {
                const status = await getBridgeStatus({
                    txHash: sourceTxHash,
                    fromChain: fromChainId,
                    toChain: 137,
                    bridge: bridgeName,
                });
                log("Bridge status:", status.status, status.substatus || "");

                if (status.status === "DONE") {
                    if (bridgePollRef.current) clearInterval(bridgePollRef.current);
                    if (bridgeTimerRef.current) clearInterval(bridgeTimerRef.current);
                    bridgePollRef.current = null;
                    bridgeTimerRef.current = null;

                    const receivedAmount = status.receiving?.amount;
                    log("Bridge completed! Received:", receivedAmount);

                    if (receivedAmount && config?.vaultAddress) {
                        await depositToVault(BigInt(receivedAmount));
                    } else {
                        log("No vault configured or no received amount, stopping at bridge-done");
                        setStep("done");
                    }
                } else if (status.status === "FAILED") {
                    if (bridgePollRef.current) clearInterval(bridgePollRef.current);
                    if (bridgeTimerRef.current) clearInterval(bridgeTimerRef.current);
                    bridgePollRef.current = null;
                    bridgeTimerRef.current = null;

                    log("Bridge FAILED:", status.substatus);
                    setError(`Bridge failed: ${status.substatus || "unknown error"}`);
                    setStep("error");
                }
            } catch (err) {
                log("Bridge status poll error (will retry):", err);
            }
        };

        poll();
        bridgePollRef.current = setInterval(poll, 10_000);
    }

    async function handlePolygonDeposit() {
        if (!wallet?.address || !config || !selectedToken || parsedAmount === 0n) return;

        log("=== POLYGON DEPOSIT START ===");
        log("Token:", selectedToken.symbol, selectedToken.address);
        log("Amount (raw):", parsedAmount.toString());
        log("Vault:", config.vaultAddress);

        const provider = await wallet.getEthereumProvider();
        const transport = custom(provider);
        const walletClient = createWalletClient({ chain: polygon, transport, account: wallet.address as Address });
        const publicClient = createPublicClient({ chain: polygon, transport });

        try {
            setStep("approving");
            log("Checking allowance...", {
                token: selectedToken.address,
                owner: wallet.address,
                spender: config.vaultAddress,
            });

            const allowance = await publicClient.readContract({
                address: selectedToken.address as Address,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [wallet.address as Address, config.vaultAddress as Address],
            }) as bigint;

            log("Current allowance:", allowance.toString(), "needed:", parsedAmount.toString());

            if (allowance < parsedAmount) {
                log("Sending approve tx (max approval)...");
                const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
                const approveTx = await walletClient.writeContract({
                    address: selectedToken.address as Address,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    args: [config.vaultAddress as Address, MAX_UINT256],
                });
                log("Approve tx sent:", approveTx);
                const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
                log("Approve confirmed, status:", approveReceipt.status);
            } else {
                log("Allowance sufficient, skipping approve");
            }

            setStep("depositing");

            const isUSDC = selectedToken.symbol === "USDC";
            let depositTx: Address;

            if (isUSDC) {
                log("Calling depositMargin with", parsedAmount.toString());
                depositTx = await walletClient.writeContract({
                    address: config.vaultAddress as Address,
                    abi: VAULT_DEPOSIT_ABI,
                    functionName: "depositMargin",
                    args: [parsedAmount],
                });
            } else {
                log("Calling depositWithSwap:", {
                    tokenIn: selectedToken.address,
                    amountIn: parsedAmount.toString(),
                    amountOutMinimum: "0",
                    poolFee: 3000,
                });
                depositTx = await walletClient.writeContract({
                    address: config.vaultAddress as Address,
                    abi: VAULT_DEPOSIT_ABI,
                    functionName: "depositWithSwap",
                    args: [
                        selectedToken.address as Address,
                        parsedAmount,
                        0n,
                        3000,
                    ],
                });
            }

            log("Deposit tx sent:", depositTx);
            const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
            log("Deposit confirmed, status:", depositReceipt.status);

            setTxHash(depositTx);
            setStep("done");
            setAmount("");
            loadBalance();
            log("=== POLYGON DEPOSIT DONE ===");
        } catch (err: any) {
            log("=== POLYGON DEPOSIT FAILED ===", err);
            setError(err.shortMessage || err.message || "Transaction failed");
            setStep("error");
        }
    }

    async function handleBridgeDeposit() {
        if (!wallet?.address || !bridgeRoute || !selectedToken) return;

        log("=== BRIDGE DEPOSIT START ===");
        log("Chain:", selectedChainId, CHAIN_LABELS[selectedChainId]);
        log("Token:", selectedToken.symbol, selectedToken.address, "decimals:", selectedToken.decimals);
        log("Amount (raw):", parsedAmount.toString());
        log("Route:", {
            bridge: bridgeRoute.usedBridgeNames,
            fromAmount: bridgeRoute.fromAmount,
            toAmount: bridgeRoute.toAmount,
            approvalAddress: bridgeRoute.approvalAddress,
            fromTokenAddress: bridgeRoute.fromTokenAddress,
        });

        const provider = await wallet.getEthereumProvider();
        const chain = CHAIN_MAP[selectedChainId];
        if (!chain) { log("No chain for", selectedChainId); return; }

        const transport = custom(provider);
        const walletClient = createWalletClient({ chain, transport, account: wallet.address as Address });
        const publicClient = createPublicClient({ chain, transport });

        try {
            setStep("approving");
            log("Fetching bridge tx data from server...");
            const txData = await getBridgeTxData(bridgeRoute);
            log("Bridge tx data:", {
                txTarget: txData.txTarget,
                value: txData.value,
                hasApprovalData: !!txData.approvalData,
                approvalData: txData.approvalData,
                txDataLength: txData.txData?.length,
            });

            if (txData.approvalData) {
                log("Checking allowance for bridge:", {
                    token: txData.approvalData.approvalTokenAddress,
                    owner: wallet.address,
                    spender: txData.approvalData.allowanceTarget,
                });

                const allowance = await publicClient.readContract({
                    address: txData.approvalData.approvalTokenAddress as Address,
                    abi: ERC20_ABI,
                    functionName: "allowance",
                    args: [wallet.address as Address, txData.approvalData.allowanceTarget as Address],
                }) as bigint;

                const needed = BigInt(txData.approvalData.minimumApprovalAmount);
                log("Allowance:", allowance.toString(), "needed:", needed.toString());

                if (allowance < needed) {
                    log("Sending approve tx for bridge...");
                    const approveTx = await walletClient.writeContract({
                        address: txData.approvalData.approvalTokenAddress as Address,
                        abi: ERC20_ABI,
                        functionName: "approve",
                        args: [txData.approvalData.allowanceTarget as Address, needed],
                    });
                    log("Approve tx sent:", approveTx);
                    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
                    log("Approve confirmed, status:", approveReceipt.status);
                } else {
                    log("Allowance sufficient, skipping approve");
                }
            } else {
                log("No approval needed (approvalData is null)");
            }

            setStep("bridging");
            log("Sending bridge tx:", {
                to: txData.txTarget,
                value: txData.value,
                dataLength: txData.txData?.length,
            });

            const bridgeTx = await walletClient.sendTransaction({
                to: txData.txTarget as Address,
                data: txData.txData as `0x${string}`,
                value: BigInt(txData.value),
            });

            log("Bridge tx sent:", bridgeTx);
            setTxHash(bridgeTx);
            setStep("bridge-waiting");

            startBridgePolling(
                bridgeTx,
                selectedChainId,
                bridgeRoute.usedBridgeNames[0] || "",
            );
        } catch (err: any) {
            log("=== BRIDGE DEPOSIT FAILED ===", err);
            setError(err.shortMessage || err.message || "Bridge transaction failed");
            setStep("error");
        }
    }

    function handleSubmit() {
        log("Submit pressed:", { chainId: selectedChainId, token: selectedSymbol, amount, parsedAmount: parsedAmount.toString(), isPolygon });
        setError(null);
        if (isPolygon) {
            switchToChain(137).then(handlePolygonDeposit);
        } else {
            switchToChain(selectedChainId).then(handleBridgeDeposit);
        }
    }

    if (!ready) return <div className="flex-1 bg-background" />;

    if (!authenticated) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background">
                <div className="text-center space-y-4">
                    <h1 className="text-xl font-semibold text-foreground">Connect wallet to deposit</h1>
                    <button onClick={login} className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors">
                        Connect Wallet
                    </button>
                </div>
            </div>
        );
    }

    const isBusy = step === "quoting" || step === "approving" || step === "depositing"
        || step === "bridging" || step === "bridge-waiting" || step === "vault-depositing";
    const canSubmit = parsedAmount > 0n && !isBusy && step !== "done" && (isPolygon || bridgeRoute !== null);

    const formatElapsed = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
    };

    return (
        <div className="flex-1 flex items-start justify-center bg-background pt-12 px-4 pb-12">
            <div className="w-full max-w-md space-y-5">
                <h1 className="text-lg font-semibold text-foreground">Deposit</h1>

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
                    <label className="text-xs text-muted-foreground">Network</label>
                    <div className="grid grid-cols-4 gap-2">
                        {config?.chains.map(chain => (
                            <button
                                key={chain.id}
                                onClick={() => setSelectedChainId(chain.id)}
                                disabled={isBusy}
                                className={cn(
                                    "py-2 text-xs font-medium rounded-lg border transition-colors",
                                    selectedChainId === chain.id
                                        ? "border-primary text-primary bg-primary/10"
                                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                                    isBusy && "opacity-50 cursor-not-allowed",
                                )}
                            >
                                {CHAIN_LABELS[chain.id] || chain.name}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Token</label>
                    <div className="grid grid-cols-2 gap-2">
                        {(["USDC", "USDT"] as const).map(sym => (
                            <button
                                key={sym}
                                onClick={() => setSelectedSymbol(sym)}
                                disabled={isBusy}
                                className={cn(
                                    "py-2 text-sm font-medium rounded-lg border transition-colors",
                                    selectedSymbol === sym
                                        ? "border-primary text-primary bg-primary/10"
                                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                                    isBusy && "opacity-50 cursor-not-allowed",
                                )}
                            >
                                {sym}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">Amount</label>
                        {balance !== null && (
                            <button
                                onClick={() => setAmount(balance)}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Balance: {Number(balance).toLocaleString("en-US", { maximumFractionDigits: 2 })} {selectedSymbol}
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
                            {selectedSymbol}
                        </span>
                    </div>
                </div>

                {!isPolygon && bridgeRoute && step === "idle" && (
                    <div className="bg-card rounded-lg border border-border p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Bridge via</span>
                            <span className="text-foreground">{bridgeRoute.usedBridgeNames.join(", ")}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">You receive (Polygon)</span>
                            <span className="text-foreground">
                                {bridgeEstimate ? `${Number(bridgeEstimate).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC` : "\u2014"}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Bridge fee</span>
                            <span className="text-foreground">
                                {bridgeFee !== null ? `~$${bridgeFee.toFixed(2)}` : "\u2014"}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Est. time</span>
                            <span className="text-foreground">
                                ~{Math.ceil((bridgeRoute.serviceTime || 60) / 60)} min
                            </span>
                        </div>
                    </div>
                )}

                {isPolygon && selectedSymbol === "USDT" && parsedAmount > 0n && (
                    <div className="bg-card rounded-lg border border-border p-3 text-xs text-muted-foreground">
                        USDT will be swapped to USDC via Uniswap before depositing into the Vault.
                    </div>
                )}

                {step === "bridge-waiting" && (
                    <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-xs space-y-2">
                        <div className="flex items-center gap-2 text-primary">
                            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            <span>Bridging in progress... ({formatElapsed(bridgeElapsed)})</span>
                        </div>
                        <div className="text-muted-foreground">
                            Waiting for USDC to arrive on Polygon. Will auto-deposit to Vault.
                        </div>
                        {txHash && (
                            <a
                                href={`https://scan.li.fi/tx/${txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline"
                            >
                                Track on LI.FI
                            </a>
                        )}
                    </div>
                )}

                {step === "vault-depositing" && (
                    <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-xs space-y-2">
                        <div className="flex items-center gap-2 text-primary">
                            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            <span>Bridge complete! Depositing USDC to Vault...</span>
                        </div>
                        <div className="text-muted-foreground">
                            Approving and depositing bridged USDC into the Vault on Polygon.
                        </div>
                    </div>
                )}

                {error && (
                    <div className="bg-loss/10 border border-loss/20 rounded-lg p-3 text-xs text-loss">
                        {error}
                    </div>
                )}

                {step === "done" && txHash && (
                    <div className="bg-success/10 border border-success/20 rounded-lg p-3 text-xs text-success space-y-1">
                        <div>Deposit successful!</div>
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
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={cn(
                        "w-full py-3 text-sm font-medium rounded-lg transition-colors",
                        canSubmit
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "bg-card text-muted-foreground cursor-not-allowed",
                    )}
                >
                    {step === "quoting" && "Getting quote..."}
                    {step === "approving" && "Approving..."}
                    {step === "depositing" && "Depositing..."}
                    {step === "bridging" && "Sending bridge tx..."}
                    {step === "bridge-waiting" && `Bridging... (${formatElapsed(bridgeElapsed)})`}
                    {step === "vault-depositing" && "Depositing to Vault..."}
                    {step === "done" && "Done"}
                    {(step === "idle" || step === "error") && (
                        isPolygon
                            ? `Deposit ${selectedSymbol}`
                            : `Bridge & Deposit ${selectedSymbol}`
                    )}
                </button>

                {!isPolygon && step === "idle" && (
                    <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                        Cross-chain deposits bridge your {selectedSymbol} to Polygon USDC via LI.FI,
                        then automatically deposit into the Vault.
                    </p>
                )}
            </div>
        </div>
    );
}
