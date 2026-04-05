import type {
    Market,
    PricePoint,
    OrderBookData,
    Position,
    TradeResult,
    DepositConfig,
    MarginInfo,
    BridgeQuote,
    BridgeRoute,
    BridgeTxData,
    BridgeStatus,
    UserLPSummary,
    PaginatedMarkets,
    PaginatedPools,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

let _cachedToken: string | null = null;
let _cacheExpiry = 0;
let _pendingPromise: Promise<string> | null = null;

async function getPrivyIdentityToken(): Promise<string> {
    if (typeof window === "undefined") return "";
    if (_cachedToken && Date.now() < _cacheExpiry) return _cachedToken;
    if (_pendingPromise) return _pendingPromise;

    _pendingPromise = (async () => {
        try {
            const { getIdentityToken } = await import("@privy-io/react-auth");
            const token = (await getIdentityToken()) || "";
            _cachedToken = token;
            _cacheExpiry = Date.now() + 30_000;
            return token;
        } catch {
            return "";
        } finally {
            _pendingPromise = null;
        }
    })();

    return _pendingPromise;
}

const DEFAULT_TIMEOUT_MS = 90_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchWithWallet(url: string, options?: any, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const token = await getPrivyIdentityToken();

    const headers = {
        ...options?.headers,
        "privy-id-token": token || "",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...options, headers, signal: controller.signal });
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
            throw new Error("Request timed out — check your positions");
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

export async function getMarkets(limit = 20, offset = 0): Promise<PaginatedMarkets> {
    try {
        const res = await fetch(
            `${API_URL}/markets?limit=${limit}&offset=${offset}`,
            { cache: "no-store" },
        );
        if (!res.ok) return { markets: [], total: 0, limit, offset };
        return res.json();
    } catch (error) {
        console.error("Failed to fetch markets:", error);
        return { markets: [], total: 0, limit, offset };
    }
}

export async function getMarketBySlug(slug: string): Promise<Market | null> {
    try {
        const data = await getMarkets(100, 0);
        return data.markets.find((m) => m.slug === slug) ?? null;
    } catch {
        return null;
    }
}

export async function getPriceHistory(
    conditionId: string,
    interval: string = "all",
    fidelity: number = 60,
): Promise<PricePoint[]> {
    try {
        const res = await fetch(
            `${API_URL}/markets/${conditionId}/prices?interval=${interval}&fidelity=${fidelity}`,
            { next: { revalidate: 30 } },
        );

        if (!res.ok) return [];

        const data = await res.json();
        return data.history ?? [];
    } catch {
        return [];
    }
}

export async function getOrderBook(conditionId: string): Promise<OrderBookData | null> {
    try {
        const res = await fetch(`${API_URL}/markets/${conditionId}/book`, {
            cache: "no-store",
        });

        if (!res.ok) return null;

        return res.json();
    } catch {
        return null;
    }
}

export async function getPositions(status: "open" | "closed" | "all" = "open"): Promise<Position[]> {
    try {
        const res = await fetchWithWallet(`${API_URL}/positions?status=${status}`, {
            cache: "no-store",
        });

        if (!res.ok) return [];

        return res.json();
    } catch {
        return [];
    }
}

// Trade
export async function placeTrade(params: {
    conditionId: string;
    outcome: "Yes" | "No";
    amount: string;
    leverage: number;
}): Promise<TradeResult> {
    const res = await fetchWithWallet(`${API_URL}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Trade failed");
    }

    return res.json();
}

// Close position
export async function closePosition(positionId: string): Promise<Position> {
    const res = await fetchWithWallet(`${API_URL}/positions/${positionId}/close`, {
        method: "POST",
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to close position");
    }
    return res.json();
}

// Deposit

export async function getDepositConfig(): Promise<DepositConfig> {
    const res = await fetch(`${API_URL}/deposit/config`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch deposit config");
    return res.json();
}

export async function getMarginBalance(address: string): Promise<MarginInfo> {
    const res = await fetch(`${API_URL}/deposit/margin/${address}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch margin");
    return res.json();
}

export async function getBridgeQuote(params: {
    fromChainId: number;
    fromTokenAddress: string;
    fromAmount: string;
    userAddress: string;
}): Promise<BridgeQuote> {
    const qs = new URLSearchParams({
        fromChainId: String(params.fromChainId),
        fromTokenAddress: params.fromTokenAddress,
        fromAmount: params.fromAmount,
        userAddress: params.userAddress,
    });
    const res = await fetch(`${API_URL}/deposit/bridge-quote?${qs}`, { cache: "no-store" });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to get bridge quote");
    }
    return res.json();
}

export async function getBridgeTxData(route: BridgeRoute): Promise<BridgeTxData> {
    const res = await fetch(`${API_URL}/deposit/bridge-tx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to build bridge transaction");
    }
    return res.json();
}

export async function getBridgeStatus(params: {
    txHash: string;
    fromChain: number;
    toChain?: number;
    bridge?: string;
}): Promise<BridgeStatus> {
    const qs = new URLSearchParams({
        txHash: params.txHash,
        fromChain: String(params.fromChain),
        toChain: String(params.toChain ?? 137),
    });
    if (params.bridge) qs.set("bridge", params.bridge);

    const res = await fetch(`${API_URL}/deposit/bridge-status?${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to check bridge status");
    return res.json();
}

// LP Pools
export async function getLPPools(limit = 20, offset = 0): Promise<PaginatedPools> {
    try {
        const res = await fetch(
            `${API_URL}/lp/pools?limit=${limit}&offset=${offset}`,
            { cache: "no-store" },
        );
        if (!res.ok) return { pools: [], total: 0, limit, offset };
        return res.json();
    } catch {
        return { pools: [], total: 0, limit, offset };
    }
}

export async function getLPUserSummary(address: string): Promise<UserLPSummary> {
    const res = await fetch(`${API_URL}/lp/user/${address}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch LP positions");
    return res.json();
}
