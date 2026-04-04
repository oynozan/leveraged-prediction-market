"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getMarkets } from "@/lib/api";
import { MarketCard } from "@/components/market-card";
import type { Market } from "@/lib/types";
import { Loader2 } from "lucide-react";

const PAGE_SIZE = 20;

export default function Home() {
    const [markets, setMarkets] = useState<Market[]>([]);
    const [initialLoad, setInitialLoad] = useState(true);
    const loadingRef = useRef(false);
    const hasMoreRef = useRef(true);
    const offsetRef = useRef(0);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const [, forceRender] = useState(0);

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMoreRef.current) return;
        loadingRef.current = true;
        forceRender((n) => n + 1);
        try {
            const data = await getMarkets(PAGE_SIZE, offsetRef.current);
            setMarkets((prev) => [...prev, ...data.markets]);
            offsetRef.current += data.markets.length;
            hasMoreRef.current = offsetRef.current < data.total;
        } catch {
            hasMoreRef.current = false;
        } finally {
            loadingRef.current = false;
            setInitialLoad(false);
            forceRender((n) => n + 1);
        }
    }, []);

    useEffect(() => {
        loadMore();
    }, [loadMore]);

    useEffect(() => {
        if (initialLoad) return;
        const el = sentinelRef.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) loadMore();
            },
            { rootMargin: "200px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [loadMore, initialLoad]);

    if (initialLoad) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (markets.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">No markets available.</p>
            </div>
        );
    }

    return (
        <div className="flex-1 w-full max-w-[1440px] mx-auto px-5 py-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {markets.map((market) => (
                    <MarketCard key={market._id} market={market} />
                ))}
            </div>

            <div ref={sentinelRef} className="flex justify-center py-6">
                {loadingRef.current && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
            </div>
        </div>
    );
}
