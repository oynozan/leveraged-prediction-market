import { ethers } from "ethers";
import Market from "../models/Markets";
import Position from "../models/Positions";
import { placeMarketOrder, fetchMidpoint, fetchNegRisk } from "./polymarket-clob";

const MAX_SLIPPAGE_BPS = 100;
const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

function applySlippage(price: number): number {
    const adj = price * (MAX_SLIPPAGE_BPS / 10_000);
    return Math.min(0.999, price + adj);
}

async function getUsdcBalance(wallet: string): Promise<bigint> {
    const rpc = process.env.POLYGON_RPC_URL;
    if (!rpc) return 0n;
    const provider = new ethers.JsonRpcProvider(rpc);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
    return usdc.balanceOf(wallet);
}

export interface TradeParams {
    wallet: string;
    conditionId: string;
    outcome: "Yes" | "No";
    amount: number;
    leverage: number;
}

export interface TradeResult {
    position: typeof Position.prototype;
    orderId: string;
}

export async function executeTrade(params: TradeParams): Promise<TradeResult> {
    const { wallet, conditionId, outcome, amount, leverage } = params;

    const market = await Market.findOne({ conditionId }).lean();
    if (!market) throw new Error("Market not found");

    const isYes = outcome === "Yes";
    const tokenId = isYes ? market.tokens.Yes.tokenId : market.tokens.No.tokenId;

    const midpoint = await fetchMidpoint(tokenId);
    if (midpoint <= 0 || midpoint >= 1) throw new Error("Invalid midpoint price");

    const price = midpoint;
    const shares = Math.floor((amount / price) * 1_000_000) / 1_000_000;
    const marginRequired = Math.ceil((amount / leverage) * 1_000_000);
    const liqPrice = isYes
        ? price * (1 - 1 / leverage)
        : Math.min(1, price * (1 + 1 / leverage));

    // Check USDC balance on Polygon
    const balance = await getUsdcBalance(wallet);
    if (balance < BigInt(marginRequired)) {
        console.error(`Insufficient liquidity: need ${marginRequired}, have ${ethers.formatUnits(balance, 6)}`);
        throw new Error(`Insufficient liquidity`);
    }

    const orderPrice = applySlippage(price);
    const negRisk = await fetchNegRisk(tokenId);

    const clobResult = await placeMarketOrder({
        tokenId,
        price: orderPrice,
        amount,
        side: 0,
        negRisk,
    });
    const orderId = clobResult.orderID;

    // Save position to MongoDB
    const position = await Position.create({
        wallet,
        conditionId,
        outcome,
        leverage: leverage.toString(),
        shares,
        entryPrice: price,
        positionValue: amount,
        liqPrice,
        status: "open",
        question: market.question,
        slug: market.slug,
        orderId,
    });

    return { position, orderId };
}
