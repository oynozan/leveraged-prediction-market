import axios from "axios";
import { CHAINS } from "./deposit";

const LIFI_API = "https://li.quest/v1";

const POLYGON_CHAIN_ID = 137;
const POLYGON_USDC = process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

export interface BridgeQuoteParams {
    fromChainId: number;
    fromTokenAddress: string;
    toChainId: number;
    toTokenAddress: string;
    fromAmount: string;
    userAddress: string;
    sort?: "output" | "gas" | "time";
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

export interface BridgeQuoteResult {
    routes: BridgeRoute[];
    fromChainId: number;
    toChainId: number;
    fromToken: { symbol: string; address: string; decimals: number };
    toToken: { symbol: string; address: string; decimals: number };
}

export async function getBridgeQuote(params: BridgeQuoteParams): Promise<BridgeQuoteResult> {
    const fromChain = CHAINS.find(c => c.id === params.fromChainId);
    if (!fromChain) throw new Error(`Unsupported source chain: ${params.fromChainId}`);

    const fromToken = fromChain.tokens.find(
        t => t.address.toLowerCase() === params.fromTokenAddress.toLowerCase(),
    );
    if (!fromToken) throw new Error(`Token ${params.fromTokenAddress} not supported on chain ${params.fromChainId}`);

    const { data } = await axios.get(`${LIFI_API}/quote`, {
        params: {
            fromChain: params.fromChainId,
            toChain: POLYGON_CHAIN_ID,
            fromToken: params.fromTokenAddress,
            toToken: POLYGON_USDC,
            fromAmount: params.fromAmount,
            fromAddress: params.userAddress,
            order: params.sort === "gas" ? "CHEAPEST" : params.sort === "time" ? "FASTEST" : "RECOMMENDED",
        },
    });

    const route: BridgeRoute = {
        routeId: data.id || data.tool,
        fromAmount: data.estimate?.fromAmount || params.fromAmount,
        toAmount: data.estimate?.toAmount || "0",
        usedBridgeNames: [data.tool || data.toolDetails?.name || "LI.FI"],
        totalGasFeesInUsd: parseFloat(data.estimate?.gasCosts?.[0]?.amountUSD || "0"),
        serviceTime: data.estimate?.executionDuration || 60,
        transactionRequest: data.transactionRequest,
        approvalAddress: data.estimate?.approvalAddress || null,
        fromTokenAddress: data.action?.fromToken?.address || params.fromTokenAddress,
    };

    return {
        routes: [route],
        fromChainId: params.fromChainId,
        toChainId: POLYGON_CHAIN_ID,
        fromToken,
        toToken: { symbol: "USDC", address: POLYGON_USDC, decimals: 6 },
    };
}

export interface BridgeTxResult {
    txTarget: string;
    txData: string;
    value: string;
    approvalData: {
        approvalTokenAddress: string;
        allowanceTarget: string;
        minimumApprovalAmount: string;
    } | null;
}

export async function getBridgeTransactionData(route: BridgeRoute): Promise<BridgeTxResult> {
    const txReq = route.transactionRequest;

    if (!txReq) {
        throw new Error("No transaction data in route — re-fetch a quote");
    }

    let approvalData: BridgeTxResult["approvalData"] = null;

    if (route.approvalAddress && route.fromTokenAddress) {
        approvalData = {
            approvalTokenAddress: route.fromTokenAddress,
            allowanceTarget: route.approvalAddress,
            minimumApprovalAmount: route.fromAmount,
        };
    }

    return {
        txTarget: txReq.to,
        txData: txReq.data,
        value: txReq.value || "0",
        approvalData,
    };
}
