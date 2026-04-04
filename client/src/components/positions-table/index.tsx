"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { getPositions, closePosition } from "@/lib/api";
import { usePrivy } from "@privy-io/react-auth";
import { io, type Socket } from "socket.io-client";
import type { Position } from "@/lib/types";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL!;

type Tab = "positions" | "history";

export function PositionsTable() {
    const [tab, setTab] = useState<Tab>("positions");
    const [openPositions, setOpenPositions] = useState<Position[]>([]);
    const [closedPositions, setClosedPositions] = useState<Position[]>([]);
    const [closingId, setClosingId] = useState<string | null>(null);
    const [closeError, setCloseError] = useState<string | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const { authenticated, getAccessToken } = usePrivy();

    // Socket connection for real-time open positions
    useEffect(() => {
        if (!authenticated) return;

        let cancelled = false;

        async function connect() {
            try {
                const token = await getAccessToken();
                if (cancelled || !token) return;

                const socket = io(SOCKET_URL, {
                    transports: ["websocket"],
                    auth: { token },
                });

                socketRef.current = socket;

                socket.on("connect", () => {
                    socket.emit("subscribe:positions");
                });

                socket.on("positions:update", (positions: Position[]) => {
                    if (!cancelled) setOpenPositions(positions);
                });

                socket.on("connect_error", () => {
                    // fall back to REST polling handled below
                });
            } catch {
                // socket connection failed, REST polling will handle it
            }
        }

        connect();

        return () => {
            cancelled = true;
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [authenticated, getAccessToken]);

    // REST polling fallback for open positions
    useEffect(() => {
        if (!authenticated) return;

        let cancelled = false;

        async function poll() {
            try {
                const data = await getPositions();
                if (!cancelled) setOpenPositions(data.filter((p) => p.status === "open"));
            } catch {
                /* ignore */
            }
        }

        poll();
        const interval = setInterval(poll, 10_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [authenticated]);

    // Fetch closed positions when switching to history tab
    useEffect(() => {
        if (tab !== "history" || !authenticated) return;

        let cancelled = false;

        async function load() {
            try {
                const data = await getPositions("closed");
                if (!cancelled) setClosedPositions(data);
            } catch {
                /* ignore */
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, [tab, authenticated]);

    const handleClose = useCallback(async (positionId: string) => {
        if (!confirm("Close this position at market price?")) return;

        setClosingId(positionId);
        setCloseError(null);

        try {
            await closePosition(positionId);
            setOpenPositions((prev) => prev.filter((p) => p._id !== positionId));
        } catch (err) {
            setCloseError(err instanceof Error ? err.message : "Failed to close");
        } finally {
            setClosingId(null);
        }
    }, []);

    const positions = tab === "positions" ? openPositions : closedPositions;

    return (
        <div className="h-full bg-(--surface) overflow-auto">
            <div className="flex items-center gap-1 px-3 pt-1.5 border-b border-border">
                {([
                    ["positions", "Positions"],
                    ["history", "Trade History"],
                ] as [Tab, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={cn(
                            "px-3 py-1.5 text-xs transition-colors",
                            tab === key
                                ? "text-foreground border-b-2 border-primary"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                        {key === "positions" && openPositions.length > 0 && (
                            <span className="ml-1 text-[9px] bg-primary/20 text-primary px-1 rounded">
                                {openPositions.length}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {closeError && (
                <div className="mx-3 mt-2 text-xs text-destructive bg-destructive/10 px-2 py-1.5 rounded">
                    {closeError}
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr className="text-muted-foreground border-b border-border">
                            <th className="text-left px-3 py-1.5 font-normal">Outcome</th>
                            <th className="text-left px-3 py-1.5 font-normal">Market</th>
                            <th className="text-right px-3 py-1.5 font-normal">Shares</th>
                            <th className="text-right px-3 py-1.5 font-normal">Position Value</th>
                            <th className="text-right px-3 py-1.5 font-normal">Entry Price</th>
                            <th className="text-right px-3 py-1.5 font-normal">Liq. Price</th>
                            {tab === "positions" && (
                                <th className="text-right px-3 py-1.5 font-normal">Close</th>
                            )}
                            {tab === "history" && (
                                <th className="text-right px-3 py-1.5 font-normal">Date</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {positions.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="px-3 py-6 text-center text-muted-foreground"
                                >
                                    {tab === "positions"
                                        ? "No open positions"
                                        : "No trade history"}
                                </td>
                            </tr>
                        ) : (
                            positions.map((pos) => (
                                <tr
                                    key={pos._id}
                                    className="border-b border-border hover:bg-card/50 transition-colors"
                                >
                                    <td className="px-3 py-1.5">
                                        <span
                                            className={cn(
                                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                                                pos.outcome === "Yes"
                                                    ? "bg-success/15 text-success"
                                                    : "bg-loss/15 text-loss",
                                            )}
                                        >
                                            {pos.outcome}{" "}
                                            <span className="text-[9px]">{pos.leverage}x</span>
                                        </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-foreground max-w-[200px] truncate">
                                        {pos.question
                                            ? pos.question.length > 40
                                                ? pos.question.slice(0, 40) + "..."
                                                : pos.question
                                            : pos.conditionId.slice(0, 10) + "..."}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        {pos.shares.toLocaleString("en-US", {
                                            minimumFractionDigits: 2,
                                        })}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        ${pos.positionValue.toFixed(2)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        {(pos.entryPrice * 100).toFixed(1)}¢
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-foreground">
                                        {(pos.liqPrice * 100).toFixed(1)}¢
                                    </td>
                                    {tab === "positions" && (
                                        <td className="px-3 py-1.5 text-right">
                                            <button
                                                onClick={() => handleClose(pos._id)}
                                                disabled={closingId === pos._id}
                                                className={cn(
                                                    "px-2 py-0.5 text-[10px] rounded transition-colors",
                                                    closingId === pos._id
                                                        ? "bg-muted text-muted-foreground cursor-wait"
                                                        : "bg-destructive/15 text-destructive hover:bg-destructive/25",
                                                )}
                                            >
                                                {closingId === pos._id ? "Closing..." : "Close"}
                                            </button>
                                        </td>
                                    )}
                                    {tab === "history" && (
                                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                                            {new Date(pos.updatedAt).toLocaleDateString("en-US", {
                                                month: "short",
                                                day: "numeric",
                                            })}
                                        </td>
                                    )}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
