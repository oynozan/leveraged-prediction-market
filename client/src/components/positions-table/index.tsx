"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getPositions } from "@/lib/api";
import { usePrivy } from "@privy-io/react-auth";
import type { Position } from "@/lib/types";

const tabs = ["Positions", "Open Orders", "Trade History", "Order History"];

export function PositionsTable() {
    const [positions, setPositions] = useState<Position[]>([]);
    const { authenticated } = usePrivy();

    useEffect(() => {
        if (!authenticated) return;

        let cancelled = false;
        async function load() {
            try {
                const data = await getPositions();
                if (!cancelled) setPositions(data.filter((p) => p.status === "open"));
            } catch {
                /* ignore */
            }
        }
        load();
        const interval = setInterval(load, 10_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [authenticated]);

    return (
        <div className="h-full bg-(--surface) overflow-auto">
            <div className="flex items-center gap-1 px-3 pt-1.5 border-b border-border">
                {tabs.map((tab) => (
                    <button
                        key={tab}
                        className={cn(
                            "px-3 py-1.5 text-xs transition-colors",
                            tab === "Positions"
                                ? "text-foreground border-b-2 border-primary"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {tab}
                    </button>
                ))}
            </div>

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
                            <th className="text-right px-3 py-1.5 font-normal">Close</th>
                        </tr>
                    </thead>
                    <tbody>
                        {positions.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={7}
                                    className="px-3 py-6 text-center text-muted-foreground"
                                >
                                    No open positions
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
                                    <td className="px-3 py-1.5 text-right">
                                        <button className="px-2 py-0.5 text-[10px] rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors">
                                            Close
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
