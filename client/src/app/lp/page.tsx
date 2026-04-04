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
} from "viem";
import { polygon } from "viem/chains";
import { cn } from "@/lib/utils";
import { getLPPools, getLPUserSummary } from "@/lib/api";
import type { PoolInfo, UserLPSummary } from "@/lib/types";
import { TrendingUp, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const USDC_DECIMALS = 6;
const SHARE_DECIMALS = 18;

const ERC20_ABI = [
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
    { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
    { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const LPPOOL_ABI = [
    { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "conditionId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
    { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "conditionId", type: "bytes32" }, { name: "shareAmount", type: "uint256" }], outputs: [] },
] as const;

type Tab = "pools" | "positions";
type ModalMode = "deposit" | "withdraw" | null;
type TxStep = "idle" | "approving" | "executing" | "error";

const LPPOOL_ADDRESS = process.env.NEXT_PUBLIC_LPPOOL_ADDRESS as Address | undefined;
const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as Address | undefined;

function fmtUsd(raw: string, decimals = USDC_DECIMALS): string {
    const n = Number(formatUnits(BigInt(raw || "0"), decimals));
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBps(bps: string): string {
    return (Number(bps) / 100).toFixed(2) + "%";
}

function fmtPct(bps: string): string {
    return (Number(bps) / 100).toFixed(1) + "%";
}

function fmtShares(raw: string): string {
    const n = Number(formatUnits(BigInt(raw || "0"), SHARE_DECIMALS));
    if (n < 0.01) return n.toFixed(6);
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatEndDate(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const days = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
    if (days < 0) return "Ended";
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days <= 30) return `${days}d left`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function LPPage() {
    const { ready, authenticated, login } = usePrivy();
    const { wallets } = useWallets();
    const wallet = wallets[0];

    const [tab, setTab] = useState<Tab>("pools");
    const [pools, setPools] = useState<PoolInfo[]>([]);
    const [initialLoad, setInitialLoad] = useState(true);
    const poolsLoadingRef = useRef(false);
    const poolsHasMoreRef = useRef(true);
    const poolsOffsetRef = useRef(0);
    const poolsSentinelRef = useRef<HTMLDivElement>(null);
    const [, forceRender] = useState(0);

    const [summary, setSummary] = useState<UserLPSummary | null>(null);

    // Modal state
    const [modalMode, setModalMode] = useState<ModalMode>(null);
    const [modalPool, setModalPool] = useState<PoolInfo | null>(null);
    const [amount, setAmount] = useState("");
    const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
    const [txStep, setTxStep] = useState<TxStep>("idle");
    const [txError, setTxError] = useState<string | null>(null);

    // User shares for the selected pool (for withdraw)
    const [userShares, setUserShares] = useState<string>("0");
    const [userValue, setUserValue] = useState<string>("0");

    const PAGE_SIZE = 20;

    const loadMorePools = useCallback(async () => {
        if (poolsLoadingRef.current || !poolsHasMoreRef.current) return;
        poolsLoadingRef.current = true;
        forceRender((n) => n + 1);
        try {
            const data = await getLPPools(PAGE_SIZE, poolsOffsetRef.current);
            setPools((prev) => [...prev, ...data.pools]);
            poolsOffsetRef.current += data.pools.length;
            poolsHasMoreRef.current = poolsOffsetRef.current < data.total;
        } catch {
            poolsHasMoreRef.current = false;
        } finally {
            poolsLoadingRef.current = false;
            setInitialLoad(false);
            forceRender((n) => n + 1);
        }
    }, []);

    const reloadPools = useCallback(() => {
        poolsOffsetRef.current = 0;
        poolsHasMoreRef.current = true;
        setPools([]);
        setInitialLoad(true);
        poolsLoadingRef.current = false;
        setTimeout(() => loadMorePools(), 0);
    }, [loadMorePools]);

    const loadSummary = useCallback(async () => {
        if (!wallet?.address) { setSummary(null); return; }
        try {
            const data = await getLPUserSummary(wallet.address);
            setSummary(data);
        } catch {
            setSummary(null);
        }
    }, [wallet?.address]);

    useEffect(() => { loadMorePools(); }, [loadMorePools]);
    useEffect(() => { loadSummary(); }, [loadSummary]);

    useEffect(() => {
        if (initialLoad) return;
        const el = poolsSentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) loadMorePools(); },
            { rootMargin: "200px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [loadMorePools, initialLoad]);

    const hasPositions = summary && summary.positions.length > 0;

    // Load USDC balance when modal opens for deposit
    useEffect(() => {
        if (modalMode !== "deposit" || !wallet?.address || !USDC_ADDRESS) { setUsdcBalance(null); return; }
        const pub = createPublicClient({ chain: polygon, transport: http() });
        pub.readContract({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [wallet.address as Address],
        }).then(r => setUsdcBalance(formatUnits(r as bigint, USDC_DECIMALS)))
            .catch(() => setUsdcBalance(null));
    }, [modalMode, wallet?.address]);

    // Load user position for the selected pool when modal opens for withdraw
    useEffect(() => {
        if (modalMode !== "withdraw" || !modalPool) return;
        const pos = summary?.positions.find(p => p.conditionId === modalPool.conditionId);
        setUserShares(pos?.shares || "0");
        setUserValue(pos?.currentValue || "0");
    }, [modalMode, modalPool, summary]);

    function openModal(pool: PoolInfo, mode: ModalMode) {
        setModalPool(pool);
        setModalMode(mode);
        setAmount("");
        setTxStep("idle");
        setTxError(null);
    }

    function closeModal() {
        setModalMode(null);
        setModalPool(null);
        setAmount("");
        setTxStep("idle");
        setTxError(null);
    }

    async function handleDeposit() {
        if (txStep === "approving" || txStep === "executing") return;
        if (!wallet?.address || !modalPool || !LPPOOL_ADDRESS || !USDC_ADDRESS) return;
        const parsed = parseUnits(amount, USDC_DECIMALS);
        if (parsed === BigInt(0)) return;

        setTxError(null);
        console.log("[lp] handleDeposit start", { amount, conditionId: modalPool.conditionId });

        try {
            await wallet.switchChain(137);
            const provider = await wallet.getEthereumProvider();
            const transport = custom(provider);
            const walletClient = createWalletClient({ chain: polygon, transport, account: wallet.address as Address });
            const publicClient = createPublicClient({ chain: polygon, transport });

            console.log("[lp] checking allowance...");
            const allowance = await publicClient.readContract({
                address: USDC_ADDRESS,
                abi: ERC20_ABI,
                functionName: "allowance",
                args: [wallet.address as Address, LPPOOL_ADDRESS],
            }) as bigint;
            console.log("[lp] allowance:", allowance.toString(), "needed:", parsed.toString());

            if (allowance < parsed) {
                setTxStep("approving");
                const MAX = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
                console.log("[lp] sending approve tx...");
                const approveTx = await walletClient.writeContract({
                    address: USDC_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: "approve",
                    args: [LPPOOL_ADDRESS, MAX],
                });
                console.log("[lp] approve tx sent:", approveTx);
                await publicClient.waitForTransactionReceipt({ hash: approveTx });
                console.log("[lp] approve confirmed");
            }

            setTxStep("executing");
            console.log("[lp] sending deposit tx...");
            const depositTx = await walletClient.writeContract({
                address: LPPOOL_ADDRESS,
                abi: LPPOOL_ABI,
                functionName: "deposit",
                args: [modalPool.conditionId as `0x${string}`, parsed],
            });
            console.log("[lp] deposit tx sent:", depositTx);
            await publicClient.waitForTransactionReceipt({ hash: depositTx });
            console.log("[lp] deposit confirmed");

            toast.success("Liquidity provided successfully!");
            closeModal();
            reloadPools();
            loadSummary();
        } catch (err: any) {
            const msg = err.shortMessage || err.message || "Transaction failed";
            console.error("[lp] deposit error:", msg, err);
            setTxError(msg);
            setTxStep("error");
            toast.error(msg);
        }
    }

    async function handleWithdraw() {
        if (txStep === "approving" || txStep === "executing") return;
        if (!wallet?.address || !modalPool || !LPPOOL_ADDRESS) return;

        let shareAmount: bigint;
        if (amount === "" || amount === "max") {
            shareAmount = BigInt(userShares);
        } else {
            const usdcWant = parseUnits(amount, USDC_DECIMALS);
            const totalDep = BigInt(modalPool.totalDeposited);
            const totalShr = BigInt(modalPool.totalShares);
            shareAmount = totalShr > BigInt(0) ? (usdcWant * totalShr) / totalDep : BigInt(0);
            if (shareAmount > BigInt(userShares)) shareAmount = BigInt(userShares);
        }

        if (shareAmount === BigInt(0)) return;
        setTxError(null);
        console.log("[lp] handleWithdraw start", { shareAmount: shareAmount.toString(), conditionId: modalPool.conditionId });

        try {
            setTxStep("executing");
            await wallet.switchChain(137);
            const provider = await wallet.getEthereumProvider();
            const transport = custom(provider);
            const walletClient = createWalletClient({ chain: polygon, transport, account: wallet.address as Address });
            const publicClient = createPublicClient({ chain: polygon, transport });

            console.log("[lp] sending withdraw tx...");
            const withdrawTx = await walletClient.writeContract({
                address: LPPOOL_ADDRESS,
                abi: LPPOOL_ABI,
                functionName: "withdraw",
                args: [modalPool.conditionId as `0x${string}`, shareAmount],
            });
            console.log("[lp] withdraw tx sent:", withdrawTx);
            await publicClient.waitForTransactionReceipt({ hash: withdrawTx });
            console.log("[lp] withdraw confirmed");

            toast.success("Withdrawal successful!");
            closeModal();
            reloadPools();
            loadSummary();
        } catch (err: any) {
            const msg = err.shortMessage || err.message || "Transaction failed";
            console.error("[lp] withdraw error:", msg, err);
            setTxError(msg);
            setTxStep("error");
            toast.error(msg);
        }
    }

    // ---------- RENDER ----------

    return (
        <div className="flex-1 w-full max-w-[1440px] mx-auto px-5 py-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h1 className="text-lg font-semibold text-foreground">LP Dashboard</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Provide liquidity to prediction markets and earn yield from leveraged trading fees.
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 mb-5 border-b border-border">
                <button
                    onClick={() => setTab("pools")}
                    className={cn(
                        "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                        tab === "pools"
                            ? "text-primary border-primary"
                            : "text-muted-foreground border-transparent hover:text-foreground",
                    )}
                >
                    LP Pools
                </button>
                {hasPositions && (
                    <button
                        onClick={() => setTab("positions")}
                        className={cn(
                            "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                            tab === "positions"
                                ? "text-primary border-primary"
                                : "text-muted-foreground border-transparent hover:text-foreground",
                        )}
                    >
                        My Positions
                    </button>
                )}
            </div>

            {/* Tab Content */}
            {tab === "pools" && (
                <>
                    <PoolsTable
                        pools={pools}
                        loading={initialLoad}
                        authenticated={authenticated}
                        ready={ready}
                        login={login}
                        userPositions={summary?.positions}
                        onDeposit={(p) => openModal(p, "deposit")}
                        onWithdraw={(p) => openModal(p, "withdraw")}
                    />
                    <div ref={poolsSentinelRef} className="flex justify-center py-4">
                        {poolsLoadingRef.current && !initialLoad && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
                    </div>
                </>
            )}

            {tab === "positions" && hasPositions && summary && (
                <PositionsView
                    summary={summary}
                    pools={pools}
                    onWithdraw={(p) => openModal(p, "withdraw")}
                />
            )}

            {/* Modal */}
            {modalMode && modalPool && (
                <Modal
                    mode={modalMode}
                    pool={modalPool}
                    amount={amount}
                    setAmount={setAmount}
                    usdcBalance={usdcBalance}
                    userShares={userShares}
                    userValue={userValue}
                    txStep={txStep}
                    txError={txError}
                    onClose={closeModal}
                    onDeposit={handleDeposit}
                    onWithdraw={handleWithdraw}
                />
            )}
        </div>
    );
}

// ---------- Pool Table ----------

function PoolsTable({
    pools,
    loading,
    authenticated,
    ready,
    login,
    userPositions,
    onDeposit,
    onWithdraw,
}: {
    pools: PoolInfo[];
    loading: boolean;
    authenticated: boolean;
    ready: boolean;
    login: () => void;
    userPositions?: { conditionId: string; currentValue: string }[];
    onDeposit: (p: PoolInfo) => void;
    onWithdraw: (p: PoolInfo) => void;
}) {
    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (pools.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <TrendingUp className="w-8 h-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No LP pools available yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Pools will appear once markets are available.</p>
            </div>
        );
    }

    return (
        <div className="bg-card/50 rounded-xl border border-white/6 overflow-hidden">
            {/* Desktop header */}
            <div className="hidden md:grid grid-cols-[3fr_0.9fr_0.9fr_1.2fr_0.8fr_1fr_auto] gap-4 px-5 py-3 text-[11px] text-muted-foreground uppercase tracking-wider border-b border-white/6 sticky top-0 bg-card z-10">
                <div>Market</div>
                <div className="text-right">TVL</div>
                <div className="text-right">APY</div>
                <div>Utilization</div>
                <div className="text-right">Expires</div>
                <div className="text-right">Position</div>
                <div className="w-[150px]" />
            </div>

            {pools.map((pool, i) => {
                const userPos = userPositions?.find(p => p.conditionId === pool.conditionId);
                const hasPosition = userPos && BigInt(userPos.currentValue) > BigInt(0);
                const util = Number(pool.utilizationBps) / 100;

                return (
                    <div key={pool.conditionId} className={cn(i % 2 === 0 ? "bg-white/3" : "bg-white/0")}>
                        {/* Desktop row */}
                        <div className="hidden md:grid grid-cols-[3fr_0.9fr_0.9fr_1.2fr_0.8fr_1fr_auto] gap-4 px-5 py-3.5 border-b border-white/4 last:border-b-0 hover:bg-white/2 transition-colors items-center">
                            <div className="min-w-0">
                                <Link
                                    href={`/trade/${pool.slug}`}
                                    className="text-[13px] font-medium text-foreground hover:text-primary transition-colors truncate block"
                                >
                                    {pool.question}
                                </Link>
                            </div>
                            <div className="text-right text-[13px] font-medium text-foreground tabular-nums">
                                {fmtUsd(pool.totalDeposited)}
                            </div>
                            <div className="text-right text-[13px] font-semibold text-primary tabular-nums">
                                {fmtBps(pool.interestRateBps)}
                            </div>
                            <div className="space-y-1">
                                <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                                    <div
                                        className={cn(
                                            "h-full rounded-full transition-all",
                                            util > 80 ? "bg-loss" : util > 60 ? "bg-yellow-500" : "bg-primary",
                                        )}
                                        style={{ width: `${Math.max(Math.min(util, 100), util > 0 ? 3 : 0)}%` }}
                                    />
                                </div>
                                <div className="text-[11px] text-muted-foreground tabular-nums">
                                    {util.toFixed(1)}% &middot; {fmtUsd(pool.availableLiquidity)} free
                                </div>
                            </div>
                            <div className="text-right text-[13px] text-muted-foreground tabular-nums">
                                {formatEndDate(pool.endDate)}
                            </div>
                            <div className="text-right text-[13px] tabular-nums">
                                {hasPosition ? (
                                    <span className="font-medium text-foreground">{fmtUsd(userPos!.currentValue)}</span>
                                ) : (
                                    <span className="text-muted-foreground/40">—</span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 w-[150px] justify-end">
                                {ready && authenticated ? (
                                    <>
                                        {hasPosition && (
                                            <button
                                                onClick={() => onWithdraw(pool)}
                                                className="h-7 px-3 text-[11px] font-medium rounded-md border border-white/10 text-foreground hover:bg-white/5 transition-colors"
                                            >
                                                Withdraw
                                            </button>
                                        )}
                                        <button
                                            onClick={() => onDeposit(pool)}
                                            className="h-7 px-3.5 text-[11px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                        >
                                            Deposit
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={login}
                                        disabled={!ready}
                                        className="h-7 px-3.5 text-[11px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                    >
                                        Connect
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Mobile card row */}
                        <div className="md:hidden px-4 py-3.5 border-b border-white/4 last:border-b-0 space-y-3">
                            <Link
                                href={`/trade/${pool.slug}`}
                                className="text-[13px] font-medium text-foreground hover:text-primary transition-colors line-clamp-2 block"
                            >
                                {pool.question}
                            </Link>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <div className="text-[10px] text-muted-foreground uppercase mb-0.5">TVL</div>
                                    <div className="text-sm font-medium text-foreground tabular-nums">{fmtUsd(pool.totalDeposited)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-muted-foreground uppercase mb-0.5">APY</div>
                                    <div className="text-sm font-semibold text-primary tabular-nums">{fmtBps(pool.interestRateBps)}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] text-muted-foreground uppercase mb-0.5">Expires</div>
                                    <div className="text-sm text-muted-foreground tabular-nums">{formatEndDate(pool.endDate)}</div>
                                </div>
                            </div>
                            {hasPosition && (
                                <div className="flex items-center justify-between bg-white/4 rounded-lg px-3 py-2">
                                    <span className="text-[11px] text-muted-foreground">Your position</span>
                                    <span className="text-sm font-medium text-foreground tabular-nums">{fmtUsd(userPos!.currentValue)}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                {ready && authenticated ? (
                                    <>
                                        <button
                                            onClick={() => onDeposit(pool)}
                                            className="flex-1 h-9 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                        >
                                            Deposit
                                        </button>
                                        {hasPosition && (
                                            <button
                                                onClick={() => onWithdraw(pool)}
                                                className="h-9 px-4 text-xs font-medium rounded-lg border border-white/10 text-foreground hover:bg-white/5 transition-colors"
                                            >
                                                Withdraw
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <button
                                        onClick={login}
                                        disabled={!ready}
                                        className="flex-1 h-9 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                                    >
                                        Connect Wallet
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ---------- Positions View ----------

function PositionsView({
    summary,
    pools,
    onWithdraw,
}: {
    summary: UserLPSummary;
    pools: PoolInfo[];
    onWithdraw: (p: PoolInfo) => void;
}) {
    return (
        <div>
            {/* Summary bar */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                <SummaryCard label="Total Value" value={fmtUsd(summary.totalCurrentValue)} />
                <SummaryCard label="Weighted APY" value={fmtBps(summary.weightedApyBps)} accent />
                <SummaryCard label="Pools Active" value={String(summary.positions.length)} />
            </div>

            {/* Positions table */}
            <div className="bg-card rounded-xl border border-white/6 overflow-hidden">
                {/* Header */}
                <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-3 px-4 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wider border-b border-white/6">
                    <div>Market</div>
                    <div className="text-right">Value</div>
                    <div className="text-right">Pool Share</div>
                    <div className="text-right">APY</div>
                    <div className="text-right">Shares</div>
                    <div className="w-20" />
                </div>

                {/* Rows */}
                {summary.positions.map((pos) => {
                    const pool = pools.find(p => p.conditionId === pos.conditionId);
                    return (
                        <div
                            key={pos.conditionId}
                            className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 md:gap-3 px-4 py-3 border-b border-white/4 last:border-b-0 hover:bg-white/2 transition-colors items-center"
                        >
                            <div>
                                <Link
                                    href={`/trade/${pos.slug}`}
                                    className="text-[13px] font-medium text-foreground hover:text-primary transition-colors line-clamp-1"
                                >
                                    {pos.question}
                                </Link>
                            </div>
                            <div className="text-right text-sm font-semibold text-foreground tabular-nums">
                                {fmtUsd(pos.currentValue)}
                            </div>
                            <div className="text-right text-sm text-muted-foreground tabular-nums">
                                {fmtPct(pos.poolSharePct)}
                            </div>
                            <div className="text-right text-sm font-medium text-primary tabular-nums">
                                {fmtBps(pos.apyBps)}
                            </div>
                            <div className="text-right text-sm text-muted-foreground tabular-nums">
                                {fmtShares(pos.shares)}
                            </div>
                            <div className="flex justify-end">
                                {pool && (
                                    <button
                                        onClick={() => onWithdraw(pool)}
                                        className="h-7 px-3 text-[11px] font-medium rounded-md border border-border text-foreground hover:bg-white/5 transition-colors"
                                    >
                                        Withdraw
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="bg-card rounded-xl border border-white/6 px-4 py-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
            <div className={cn("text-lg font-bold tabular-nums", accent ? "text-primary" : "text-foreground")}>
                {value}
            </div>
        </div>
    );
}

// ---------- Modal ----------

function Modal({
    mode,
    pool,
    amount,
    setAmount,
    usdcBalance,
    userShares,
    userValue,
    txStep,
    txError,
    onClose,
    onDeposit,
    onWithdraw,
}: {
    mode: "deposit" | "withdraw";
    pool: PoolInfo;
    amount: string;
    setAmount: (v: string) => void;
    usdcBalance: string | null;
    userShares: string;
    userValue: string;
    txStep: TxStep;
    txError: string | null;
    onClose: () => void;
    onDeposit: () => void;
    onWithdraw: () => void;
}) {
    const isDeposit = mode === "deposit";
    const maxLabel = isDeposit ? usdcBalance : formatUnits(BigInt(userValue || "0"), USDC_DECIMALS);
    const maxUsd = maxLabel ? Number(maxLabel) : 0;
    const inputVal = Number(amount || "0");
    const canSubmit = (txStep === "idle" || txStep === "error") && inputVal > 0 && inputVal <= maxUsd;

    const isPending = txStep === "approving" || txStep === "executing";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Panel */}
            <div className="relative w-full max-w-md bg-card rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/6">
                    <h2 className="text-sm font-semibold text-foreground">
                        {isDeposit ? "Provide Liquidity" : "Withdraw Liquidity"}
                    </h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {/* Market info */}
                    <div className="text-[13px] text-foreground font-medium leading-snug line-clamp-2">
                        {pool.question}
                    </div>

                    {/* Pool stats mini */}
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                            <div className="text-[10px] text-muted-foreground uppercase">TVL</div>
                            <div className="text-xs font-semibold text-foreground tabular-nums">{fmtUsd(pool.totalDeposited)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-muted-foreground uppercase">APY</div>
                            <div className="text-xs font-semibold text-primary tabular-nums">{fmtBps(pool.interestRateBps)}</div>
                        </div>
                        <div>
                            <div className="text-[10px] text-muted-foreground uppercase">Util</div>
                            <div className="text-xs font-semibold text-foreground tabular-nums">{fmtPct(pool.utilizationBps)}</div>
                        </div>
                    </div>

                    {/* Amount input */}
                    <div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                            <span>{isDeposit ? "Amount (USDC)" : "Amount to withdraw (USDC)"}</span>
                            {maxLabel !== null && (
                                <button
                                    onClick={() => setAmount(String(maxUsd))}
                                    className="text-primary hover:underline"
                                >
                                    Max: {Number(maxLabel).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                                </button>
                            )}
                        </div>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full h-10 px-3 bg-background border border-border rounded-lg text-sm text-foreground tabular-nums placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            disabled={isPending}
                        />
                    </div>

                    {/* Error */}
                    {txError && (
                        <div className="text-xs text-loss bg-loss/10 rounded-lg px-3 py-2 break-all">
                            {txError}
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        onClick={isDeposit ? onDeposit : onWithdraw}
                        disabled={(!canSubmit && !isPending) || isPending}
                        className={cn(
                            "w-full h-10 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2",
                            isDeposit
                                ? "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                                : "bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40",
                        )}
                    >
                        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                        {txStep === "approving" && "Approving USDC..."}
                        {txStep === "executing" && (isDeposit ? "Depositing..." : "Withdrawing...")}
                        {(txStep === "idle" || txStep === "error") && (isDeposit ? "Deposit" : "Withdraw")}
                    </button>
                </div>
            </div>
        </div>
    );
}
