"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useMarketData } from "@/contexts/market-data";
import { placeTrade } from "@/lib/api";
import { useUsdcBalance } from "@/hooks/use-usdc-balance";
import { useTradeProgress } from "@/hooks/use-trade-progress";
import { usePrivy } from "@privy-io/react-auth";
import type { Market } from "@/lib/types";

interface TradingPanelProps {
    market: Market;
}

const MAX_LEVERAGE = 3;
const LEVERAGE_PRESETS = [1, 2, 3];
const AMOUNT_PRESETS = [25, 50, 75, 100];

function LeverageModal({
    leverage,
    onConfirm,
    onClose,
}: {
    leverage: number;
    onConfirm: (lev: number) => void;
    onClose: () => void;
}) {
    const [value, setValue] = useState(leverage);
    const trackRef = useRef<HTMLDivElement>(null);

    const range = MAX_LEVERAGE - 1;

    const handleTrackClick = (ev: React.MouseEvent<HTMLDivElement>) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        setValue(Math.max(1, Math.min(MAX_LEVERAGE, Math.round(pct * range + 1))));
    };

    const handleDrag = useCallback(() => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();

        const move = (ev: PointerEvent) => {
            const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            setValue(Math.max(1, Math.min(MAX_LEVERAGE, Math.round(pct * range + 1))));
        };

        const up = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
        };

        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    }, [range]);

    const pct = ((value - 1) / range) * 100;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div
                className="bg-(--surface) border border-border rounded-lg w-[340px] p-5 space-y-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">Adjust Leverage</h3>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground text-lg leading-none"
                    >
                        &times;
                    </button>
                </div>

                <div className="flex items-center justify-center">
                    <span className="text-3xl font-bold text-primary">{value}x</span>
                </div>

                <div className="space-y-3">
                    <div
                        ref={trackRef}
                        className="relative h-2 bg-card rounded-full cursor-pointer"
                        onClick={handleTrackClick}
                    >
                        <div
                            className="absolute h-full bg-primary rounded-full"
                            style={{ width: `${pct}%` }}
                        />
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary border-2 border-(--surface) cursor-grab"
                            style={{ left: `calc(${pct}% - 8px)` }}
                            onPointerDown={handleDrag}
                        />
                    </div>

                    <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>1x</span>
                        <span>2x</span>
                        <span>3x</span>
                    </div>
                </div>

                <div className="flex gap-2">
                    {LEVERAGE_PRESETS.map((lev) => (
                        <button
                            key={lev}
                            onClick={() => setValue(lev)}
                            className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                                value === lev
                                    ? "bg-primary text-white border-primary"
                                    : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            {lev}x
                        </button>
                    ))}
                </div>

                <button
                    onClick={() => onConfirm(value)}
                    className="w-full py-2.5 text-sm font-medium rounded bg-primary hover:bg-primary/90 text-white transition-colors"
                >
                    Confirm
                </button>
            </div>
        </div>
    );
}

export function TradingPanel({ market }: TradingPanelProps) {
    const [outcome, setOutcome] = useState<"Yes" | "No">("Yes");
    const [amount, setAmount] = useState("");
    const [leverage, setLeverage] = useState(2);
    const [leverageModalOpen, setLeverageModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [sliderValue, setSliderValue] = useState(0);

    const { book } = useMarketData();
    const { user, authenticated } = usePrivy();

    const walletAddress = user?.wallet?.address;
    const usdcBalance = useUsdcBalance(walletAddress);
    const tradeProgress = useTradeProgress(loading);

    const liveYes = book?.last_trade_price ? parseFloat(book.last_trade_price) : null;
    const currentYesPrice = liveYes !== null ? liveYes : market.tokens.Yes.price;
    const currentNoPrice = 1 - currentYesPrice;
    const currentPrice = outcome === "Yes" ? currentYesPrice : currentNoPrice;

    const availableUsd = usdcBalance !== null ? parseFloat(usdcBalance) : null;

    // Sync slider -> amount (based on USDC balance * leverage)
    useEffect(() => {
        if (availableUsd !== null && availableUsd > 0 && sliderValue > 0) {
            const maxPosition = availableUsd * leverage;
            const val = (sliderValue / 100) * maxPosition;
            setAmount(val > 0 ? val.toFixed(2) : "");
        }
    }, [sliderValue, availableUsd, leverage]);

    const numAmount = parseFloat(amount) || 0;
    const oddsOutOfRange = currentYesPrice < 0.10 || currentYesPrice > 0.90;
    const marginRequired = numAmount > 0 ? numAmount / leverage : 0;
    const shares = numAmount > 0 && currentPrice > 0 ? numAmount / currentPrice : 0;
    const liqPrice =
        outcome === "Yes"
            ? currentPrice * (1 - 1 / leverage)
            : Math.min(1, currentPrice * (1 + 1 / leverage));
    const fees = numAmount * 0.005;

    const handleAmountChange = (val: string) => {
        setAmount(val);
        setSliderValue(0);
        setError(null);
        setSuccess(null);
    };

    const handleTrade = useCallback(async () => {
        if (!authenticated || !walletAddress) {
            setError("Connect wallet first");
            return;
        }
        if (numAmount < 1) {
            setError("Minimum position size is $1");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const result = await placeTrade({
                conditionId: market.conditionId,
                outcome,
                amount: numAmount.toString(),
                leverage,
            });
            window.dispatchEvent(new CustomEvent("position:created", { detail: result.position }));
            setSuccess(`Position opened — Order ${result.orderId.slice(0, 8)}...`);
            setAmount("");
            setSliderValue(0);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Trade failed");
        } finally {
            setLoading(false);
        }
    }, [authenticated, walletAddress, numAmount, market.conditionId, outcome, leverage]);

    const yesPercent = Math.round(currentYesPrice * 100);
    const noPercent = 100 - yesPercent;

    const fmtUsd = (v: number) =>
        v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

    return (
        <div className="flex flex-col h-full bg-(--surface) overflow-y-auto">
            {/* Leverage badge */}
            <div className="flex items-center justify-end gap-0 border-b border-border">
                <div className="flex items-center justify-end gap-1 px-2 py-2">
                    <button
                        onClick={() => setLeverageModalOpen(true)}
                        className="text-[10px] font-semibold text-white/80 bg-white/10 px-5 py-0.5 rounded cursor-pointer hover:bg-white/15 transition-colors"
                    >
                        {leverage}x
                    </button>
                </div>
            </div>

            <div className="p-3 space-y-3">
                {/* YES / NO toggle */}
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => setOutcome("Yes")}
                        className={`py-2 text-xs rounded font-medium transition-colors ${
                            outcome === "Yes"
                                ? "bg-success text-white"
                                : "bg-card text-muted-foreground border border-border hover:text-foreground"
                        }`}
                    >
                        Yes {yesPercent}¢
                    </button>
                    <button
                        onClick={() => setOutcome("No")}
                        className={`py-2 text-xs rounded font-medium transition-colors ${
                            outcome === "No"
                                ? "bg-destructive text-white"
                                : "bg-card text-muted-foreground border border-border hover:text-foreground"
                        }`}
                    >
                        No {noPercent}¢
                    </button>
                </div>

                {/* Amount input */}
                <div>
                    <label className="text-[10px] text-muted-foreground mb-1 block">
                        Position Size (USDC)
                    </label>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => handleAmountChange(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary/50 transition-colors"
                    />
                </div>

                {/* Amount slider */}
                <div className="space-y-2">
                    <div className="relative h-1.5 bg-card rounded-full">
                        <div
                            className="absolute h-full bg-primary rounded-full"
                            style={{ width: `${sliderValue}%` }}
                        />
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={sliderValue}
                            onChange={(e) => setSliderValue(Number(e.target.value))}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-(--surface) pointer-events-none"
                            style={{ left: `calc(${sliderValue}% - 7px)` }}
                        />
                    </div>
                    <div className="flex justify-between">
                        {AMOUNT_PRESETS.map((pct) => (
                            <button
                                key={pct}
                                onClick={() => setSliderValue(pct)}
                                className={`text-[9px] px-2 py-0.5 rounded transition-colors ${
                                    sliderValue === pct
                                        ? "bg-primary/20 text-primary"
                                        : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {pct}%
                            </button>
                        ))}
                    </div>
                </div>

                {/* Trade button */}
                <button
                    onClick={handleTrade}
                    disabled={loading || numAmount < 1 || oddsOutOfRange}
                    className={`w-full py-2.5 text-sm font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        outcome === "Yes"
                            ? "bg-success hover:bg-success/90 text-white"
                            : "bg-destructive hover:bg-destructive/90 text-white"
                    }`}
                >
                    {loading ? (
                        <span className="flex items-center justify-center gap-2">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    fill="none"
                                />
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                />
                            </svg>
                            {tradeProgress
                                ? `${tradeProgress.label} (${tradeProgress.step}/${tradeProgress.total})`
                                : "Executing..."}
                        </span>
                    ) : oddsOutOfRange ? (
                        "Trading Disabled (odds outside 10–90%)"
                    ) : outcome === "Yes" ? (
                        "Buy Yes"
                    ) : (
                        "Buy No"
                    )}
                </button>

                {/* Error / Success messages */}
                {error && (
                    <p className="text-xs text-destructive bg-destructive/10 px-2 py-1.5 rounded">
                        {error}
                    </p>
                )}
                {success && (
                    <p className="text-xs text-success bg-success/10 px-2 py-1.5 rounded">
                        {success}
                    </p>
                )}

                {/* Live calculations */}
                <div className="space-y-1 text-[11px]">
                    {(
                        [
                            ["Est. Liquidation", numAmount > 0 ? `${(liqPrice * 100).toFixed(1)}¢` : "—"],
                            ["Position Value", numAmount > 0 ? fmtUsd(numAmount) : "—"],
                            ["Margin Required", numAmount > 0 ? fmtUsd(marginRequired) : "—"],
                            ["Shares", numAmount > 0 ? shares.toFixed(2) : "—"],
                            ["Fees (0.5%)", numAmount > 0 ? fmtUsd(fees) : "—"],
                        ] as [string, string][]
                    ).map(([label, value]) => (
                        <div key={label} className="flex justify-between">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="text-foreground">{value}</span>
                        </div>
                    ))}
                </div>

                {/* Account info */}
                <div className="space-y-1 text-[11px] pt-1 border-t border-border">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Available Margin</span>
                        <span className="text-foreground">
                            {availableUsd !== null ? fmtUsd(availableUsd) : "—"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Leverage modal */}
            {leverageModalOpen && (
                <LeverageModal
                    leverage={leverage}
                    onConfirm={(lev) => {
                        setLeverage(lev);
                        setLeverageModalOpen(false);
                    }}
                    onClose={() => setLeverageModalOpen(false)}
                />
            )}
        </div>
    );
}
