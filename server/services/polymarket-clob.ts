import crypto from "crypto";
import { ethers } from "ethers";
import { proxyAxios } from "../lib/proxy-axios";

const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";

const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

const CLOB_API = process.env.CLOB_API_URL || "https://clob.polymarket.com";

const EIP712_DOMAIN = {
    name: "Polymarket CTF Exchange",
    version: "1",
    chainId: 137,
    verifyingContract: CTF_EXCHANGE,
};

const NEG_RISK_EIP712_DOMAIN = {
    ...EIP712_DOMAIN,
    verifyingContract: NEG_RISK_CTF_EXCHANGE,
};

const ORDER_TYPES = {
    Order: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "expiration", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "feeRateBps", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "signatureType", type: "uint8" },
    ],
};

/* L2 HMAC-SHA256 authentication */

function buildL2Headers(
    method: string,
    requestPath: string,
    body: string,
    timestamp: string,
): Record<string, string> {
    const apiKey = process.env.POLY_API_KEY!;
    const apiSecret = process.env.POLY_API_SECRET!;
    const passphrase = process.env.POLY_PASSPHRASE!;
    const walletPk = process.env.POLY_WALLET_PK!;
    const wallet = new ethers.Wallet(walletPk);

    const secret = Buffer.from(apiSecret, "base64");
    const msg = timestamp + method + requestPath + body;
    const sig = crypto.createHmac("sha256", secret).update(msg).digest("base64");

    return {
        "POLY-ADDRESS": wallet.address,
        "POLY-SIGNATURE": sig,
        "POLY-TIMESTAMP": timestamp,
        "POLY-API-KEY": apiKey,
        "POLY-PASSPHRASE": passphrase,
    };
}

/* Order helpers */

const Side = { BUY: 0, SELL: 1 } as const;
type SideValue = (typeof Side)[keyof typeof Side];

interface OrderParams {
    tokenId: string;
    price: number;
    size: number;
    side: SideValue;
    feeRateBps: number;
    negRisk: boolean;
}

interface SignedOrder {
    salt: string;
    maker: string;
    signer: string;
    taker: string;
    tokenId: string;
    makerAmount: string;
    takerAmount: string;
    expiration: string;
    nonce: string;
    feeRateBps: string;
    side: number;
    signatureType: number;
    signature: string;
}

function computeAmounts(
    price: number,
    size: number,
    side: SideValue,
): { makerAmount: bigint; takerAmount: bigint } {
    const rawPrice = BigInt(Math.round(price * Number(USDC_SCALE)));
    const rawSize = BigInt(Math.round(size * Number(USDC_SCALE)));

    if (side === Side.BUY) {
        return {
            makerAmount: (rawSize * rawPrice) / USDC_SCALE,
            takerAmount: rawSize,
        };
    }
    return {
        makerAmount: rawSize,
        takerAmount: (rawSize * rawPrice) / USDC_SCALE,
    };
}

function makeSalt(tokenId: string, side: SideValue, ts: number): bigint {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(`${tokenId}:${side}:${ts}`));
    return BigInt(hash);
}

async function buildAndSignOrder(params: OrderParams): Promise<SignedOrder> {
    const walletPk = process.env.POLY_WALLET_PK!;
    const wallet = new ethers.Wallet(walletPk);

    const ts = Math.floor(Date.now() / 1000);
    const { makerAmount, takerAmount } = computeAmounts(params.price, params.size, params.side);
    const salt = makeSalt(params.tokenId, params.side, ts);

    const order = {
        salt,
        maker: wallet.address,
        signer: wallet.address,
        taker: ethers.ZeroAddress,
        tokenId: BigInt(params.tokenId),
        makerAmount,
        takerAmount,
        expiration: 0n,
        nonce: 0n,
        feeRateBps: BigInt(params.feeRateBps),
        side: params.side,
        signatureType: 0,
    };

    const domain = params.negRisk ? NEG_RISK_EIP712_DOMAIN : EIP712_DOMAIN;
    const signature = await wallet.signTypedData(domain, ORDER_TYPES, order);

    return {
        salt: salt.toString(),
        maker: wallet.address,
        signer: wallet.address,
        taker: ethers.ZeroAddress,
        tokenId: params.tokenId,
        makerAmount: makerAmount.toString(),
        takerAmount: takerAmount.toString(),
        expiration: "0",
        nonce: "0",
        feeRateBps: params.feeRateBps.toString(),
        side: params.side,
        signatureType: 0,
        signature,
    };
}

/* Public API */

export interface PlaceOrderResult {
    success: boolean;
    orderID: string;
    status: string;
    errorMsg: string;
}

export async function placeMarketOrder(params: {
    tokenId: string;
    price: number;
    size: number;
    side: SideValue;
    negRisk: boolean;
    feeRateBps?: number;
}): Promise<PlaceOrderResult> {
    const signedOrder = await buildAndSignOrder({
        tokenId: params.tokenId,
        price: params.price,
        size: params.size,
        side: params.side,
        feeRateBps: params.feeRateBps ?? 100,
        negRisk: params.negRisk,
    });

    const path = "/order";
    const body = JSON.stringify({
        order: signedOrder,
        owner: signedOrder.maker,
        orderType: "FOK",
    });

    const ts = Math.floor(Date.now() / 1000).toString();
    const headers = buildL2Headers("POST", path, body, ts);

    const resp = await proxyAxios.post(`${CLOB_API}${path}`, body, {
        headers: { ...headers, "Content-Type": "application/json" },
    });

    return resp.data as PlaceOrderResult;
}

export async function fetchMidpoint(tokenId: string): Promise<number> {
    const resp = await proxyAxios.get(`${CLOB_API}/midpoint`, {
        params: { token_id: tokenId },
    });

    return parseFloat(resp.data.mid);
}
