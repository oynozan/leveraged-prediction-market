"use client";

import { useState, useEffect, useCallback } from "react";
import { formatUnits } from "viem";
import { getMarginBalance } from "@/lib/api";

export function useUsdcBalance(address: string | undefined) {
    const [balance, setBalance] = useState<string | null>(null);

    const fetchBalance = useCallback(async () => {
        if (!address) return;
        try {
            const margin = await getMarginBalance(address);
            setBalance(formatUnits(BigInt(margin.available), 6));
        } catch {
            /* ignore */
        }
    }, [address]);

    useEffect(() => {
        if (!address) return;

        fetchBalance();
        const interval = setInterval(fetchBalance, 30_000);
        return () => clearInterval(interval);
    }, [address, fetchBalance]);

    useEffect(() => {
        const handler = () => {
            fetchBalance();
        };

        window.addEventListener("balance:update", handler);
        window.addEventListener("position:created", handler);
        window.addEventListener("position:closed", handler);
        return () => {
            window.removeEventListener("balance:update", handler);
            window.removeEventListener("position:created", handler);
            window.removeEventListener("position:closed", handler);
        };
    }, [fetchBalance]);

    if (!address) return null;
    return balance;
}
