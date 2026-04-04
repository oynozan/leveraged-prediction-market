export interface TokenSide {
    tokenId: string;
    price: number;
}

export interface Market {
    _id: string;
    conditionId: string;
    question: string;
    slug: string;
    endDate: string;
    tokens: {
        Yes: TokenSide;
        No: TokenSide;
    };
    syncedAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface PricePoint {
    t: number;
    p: number;
}

export interface OrderBookLevel {
    price: string;
    size: string;
}

export interface OrderBookData {
    market: string;
    asset_id: string;
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    last_trade_price: string;
    spread: string;
}

export interface Position {
    _id: string;
    conditionId: string;
    outcome: "Yes" | "No";
    leverage: string;
    shares: number;
    entryPrice: number;
    positionValue: number;
    marginAmount: number;
    borrowedAmount: number;
    liqPrice: number;
    status: "open" | "closed";
    settled: boolean;
    question?: string;
    slug?: string;
    orderId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface TradeResult {
    position: Position;
    orderId: string;
}

// Deposit types

export interface DepositToken {
    symbol: string;
    address: string;
    decimals: number;
}

export interface ChainConfig {
    id: number;
    name: string;
    tokens: DepositToken[];
}

export interface DepositConfig {
    vaultAddress: string;
    vaultChainId: number;
    usdcAddress: string;
    chains: ChainConfig[];
}

export interface MarginInfo {
    total: string;
    locked: string;
    available: string;
}

export interface BridgeRoute {
    routeId: string;
    fromAmount: string;
    toAmount: string;
    usedBridgeNames: string[];
    totalGasFeesInUsd: number;
    serviceTime: number;
    transactionRequest: any;
    approvalAddress: string | null;
    fromTokenAddress: string;
}

export interface BridgeQuote {
    routes: BridgeRoute[];
    fromChainId: number;
    toChainId: number;
    fromToken: DepositToken;
    toToken: DepositToken;
}

export interface BridgeTxData {
    txTarget: string;
    txData: string;
    value: string;
    approvalData: {
        approvalTokenAddress: string;
        allowanceTarget: string;
        minimumApprovalAmount: string;
    } | null;
}

export interface BridgeStatus {
    status: "NOT_FOUND" | "PENDING" | "DONE" | "FAILED";
    substatus?: string;
    receiving?: {
        amount: string;
        token: { address: string; decimals: number; symbol: string } | null;
        txHash: string | null;
    } | null;
}

// LP Pool types

export interface PoolInfo {
    conditionId: string;
    question: string;
    slug: string;
    endDate: string;
    totalDeposited: string;
    totalBorrowed: string;
    availableLiquidity: string;
    utilizationBps: string;
    interestRateBps: string;
    sharePrice: string;
    totalShares: string;
}

export interface LPPosition {
    conditionId: string;
    question: string;
    slug: string;
    shares: string;
    currentValue: string;
    poolSharePct: string;
    apyBps: string;
}

export interface UserLPSummary {
    positions: LPPosition[];
    totalCurrentValue: string;
    weightedApyBps: string;
}
