import { ethers } from "ethers";
import { getProvider } from "../lib/contracts";

// Uniswap V3 Quoter V2 ABI (minimal)
const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

// Polygon addresses
const QUOTER_ADDRESS = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

export interface SwapQuote {
    tokenIn: string;
    amountIn: string;
    expectedOut: string;
    amountOutMinimum: string;
    poolFee: number;
    priceImpactBps: number;
}

const COMMON_FEES = [500, 3000, 10000] as const;

export async function getQuote(
    tokenIn: string,
    amountIn: string,
    slippageBps: number = 50,
): Promise<SwapQuote> {
    const provider = getProvider();
    const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);

    let bestOut = 0n;
    let bestFee = 3000;

    for (const fee of COMMON_FEES) {
        try {
            const out: bigint = await quoter.quoteExactInputSingle.staticCall(
                tokenIn,
                USDC_ADDRESS,
                fee,
                BigInt(amountIn),
                0,
            );
            if (out > bestOut) {
                bestOut = out;
                bestFee = fee;
            }
        } catch {
            // Pool doesn't exist for this fee tier
        }
    }

    if (bestOut === 0n) {
        throw new Error(`No Uniswap V3 pool found for ${tokenIn} -> USDC`);
    }

    const amountOutMinimum = (bestOut * BigInt(10000 - slippageBps)) / 10000n;

    // Rough price impact: compare to a smaller trade
    let priceImpactBps = 0;
    try {
        const smallAmount = BigInt(amountIn) / 100n;
        if (smallAmount > 0n) {
            const smallOut: bigint = await quoter.quoteExactInputSingle.staticCall(
                tokenIn,
                USDC_ADDRESS,
                bestFee,
                smallAmount,
                0,
            );
            const scaledSmallOut = smallOut * 100n;
            if (scaledSmallOut > 0n) {
                priceImpactBps = Number(
                    ((scaledSmallOut - bestOut) * 10000n) / scaledSmallOut,
                );
            }
        }
    } catch {
        // Ignore — price impact estimation is best-effort
    }

    return {
        tokenIn,
        amountIn,
        expectedOut: bestOut.toString(),
        amountOutMinimum: amountOutMinimum.toString(),
        poolFee: bestFee,
        priceImpactBps: Math.max(0, priceImpactBps),
    };
}
