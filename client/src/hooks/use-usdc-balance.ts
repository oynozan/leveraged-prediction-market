"use client";

import { useState, useEffect } from "react";
import { formatUnits } from "viem";
import { getMarginBalance } from "@/lib/api";

export function useUsdcBalance(address: string | undefined) {
    const [balance, setBalance] = useState<string | null>(null);

    useEffect(() => {
        if (!address) return;

        let cancelled = false;

        async function fetchBalance() {
            try {
                const margin = await getMarginBalance(address!);
                if (!cancelled) {
                    setBalance(formatUnits(BigInt(margin.available), 6));
                }
            } catch {
                if (!cancelled) setBalance(null);
            }
        }

        fetchBalance();
        const interval = setInterval(fetchBalance, 30_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [address]);

    if (!address) return null;
    return balance;
}
