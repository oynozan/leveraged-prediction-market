import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { getQuote } from "./swap";

const POLYGON_USDC = process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const WMATIC_ADDRESS = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";

export interface ChainToken {
    symbol: string;
    address: string;
    decimals: number;
}

export interface ChainConfig {
    id: number;
    name: string;
    tokens: ChainToken[];
}

export const CHAINS: ChainConfig[] = [
    {
        id: 1,
        name: "Ethereum",
        tokens: [
            { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
            { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
        ],
    },
    {
        id: 56,
        name: "BNB Chain",
        tokens: [
            { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
            { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
        ],
    },
    {
        id: 42161,
        name: "Arbitrum",
        tokens: [
            { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
            { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
        ],
    },
    {
        id: 137,
        name: "Polygon",
        tokens: [
            { symbol: "USDC", address: POLYGON_USDC, decimals: 6 },
            { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
        ],
    },
];

const POLYGON_SUPPORTED_TOKENS = [
    { symbol: "USDC", address: POLYGON_USDC, decimals: 6 },
    { symbol: "WETH", address: WETH_ADDRESS, decimals: 18 },
    { symbol: "WMATIC", address: WMATIC_ADDRESS, decimals: 18 },
    { symbol: "MATIC", address: "native", decimals: 18 },
];

function loadVaultInterface(): ethers.Interface {
    const abiPath = path.join(__dirname, "..", "abis", "Vault.json");
    const abi = JSON.parse(fs.readFileSync(abiPath, "utf-8"));
    return new ethers.Interface(abi);
}

export function getDepositConfig() {
    return {
        vaultAddress: process.env.VAULT_ADDRESS || null,
        vaultChainId: 137,
        usdcAddress: POLYGON_USDC,
        chains: CHAINS,
        polygonTokens: POLYGON_SUPPORTED_TOKENS,
    };
}

export interface DepositTxResult {
    tokenIn: string;
    amountIn: string;
    expectedUsdcOut: string;
    amountOutMinimum: string;
    poolFee: number;
    priceImpactBps: number;
    transaction: {
        to: string;
        data: string;
        value: string;
    };
    approval: {
        token: string;
        spender: string;
        amount: string;
    } | null;
}

export async function buildDepositTx(
    tokenIn: string,
    amountIn: string,
    slippageBps: number = 50,
): Promise<DepositTxResult> {
    const vaultAddress = process.env.VAULT_ADDRESS;
    if (!vaultAddress) throw new Error("VAULT_ADDRESS is not configured");

    const iface = loadVaultInterface();
    const isNative = tokenIn.toLowerCase() === "native";
    const isUSDC = tokenIn.toLowerCase() === POLYGON_USDC.toLowerCase();

    if (isUSDC) {
        const data = iface.encodeFunctionData("depositMargin", [BigInt(amountIn)]);

        return {
            tokenIn: POLYGON_USDC,
            amountIn,
            expectedUsdcOut: amountIn,
            amountOutMinimum: amountIn,
            poolFee: 0,
            priceImpactBps: 0,
            transaction: {
                to: vaultAddress,
                data,
                value: "0",
            },
            approval: {
                token: POLYGON_USDC,
                spender: vaultAddress,
                amount: amountIn,
            },
        };
    }

    const quoteTokenIn = isNative ? WMATIC_ADDRESS : tokenIn;
    const quote = await getQuote(quoteTokenIn, amountIn, slippageBps);

    if (isNative) {
        const data = iface.encodeFunctionData("depositETHWithSwap", [
            BigInt(quote.amountOutMinimum),
            quote.poolFee,
        ]);

        return {
            tokenIn: "native",
            amountIn,
            expectedUsdcOut: quote.expectedOut,
            amountOutMinimum: quote.amountOutMinimum,
            poolFee: quote.poolFee,
            priceImpactBps: quote.priceImpactBps,
            transaction: {
                to: vaultAddress,
                data,
                value: amountIn,
            },
            approval: null,
        };
    }

    const data = iface.encodeFunctionData("depositWithSwap", [
        tokenIn,
        BigInt(amountIn),
        BigInt(quote.amountOutMinimum),
        quote.poolFee,
    ]);

    return {
        tokenIn,
        amountIn,
        expectedUsdcOut: quote.expectedOut,
        amountOutMinimum: quote.amountOutMinimum,
        poolFee: quote.poolFee,
        priceImpactBps: quote.priceImpactBps,
        transaction: {
            to: vaultAddress,
            data,
            value: "0",
        },
        approval: {
            token: tokenIn,
            spender: vaultAddress,
            amount: amountIn,
        },
    };
}
