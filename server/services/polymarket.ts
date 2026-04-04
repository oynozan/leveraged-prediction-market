import axios from "axios";
import Market from "../models/Markets";

const CLOB_API = "https://clob.polymarket.com";

type Level = { price: string; size: string };

const invert = (levels: Level[]): Level[] =>
    levels.map((l) => ({
        price: (1 - parseFloat(l.price)).toFixed(4),
        size: l.size,
    }));

export async function fetchMergedBook(conditionId: string) {
    const market = await Market.findOne({ conditionId }, { tokens: 1 }).lean();
    if (!market) return null;

    const [yesBook, noBook] = await Promise.all([
        axios.get(`${CLOB_API}/book`, { params: { token_id: market.tokens.Yes.tokenId } }),
        axios.get(`${CLOB_API}/book`, { params: { token_id: market.tokens.No.tokenId } }),
    ]);

    const combinedBids = [...(yesBook.data.bids ?? []), ...invert(noBook.data.asks ?? [])]
        .sort((a: Level, b: Level) => parseFloat(b.price) - parseFloat(a.price));

    const combinedAsks = [...(yesBook.data.asks ?? []), ...invert(noBook.data.bids ?? [])]
        .sort((a: Level, b: Level) => parseFloat(a.price) - parseFloat(b.price));

    const bestBid = combinedBids[0] ? parseFloat(combinedBids[0].price) : 0;
    const bestAsk = combinedAsks[0] ? parseFloat(combinedAsks[0].price) : 1;
    const mid = (bestBid + bestAsk) / 2;

    const yesLast = parseFloat(yesBook.data.last_trade_price || "0");
    const noLastInverted = 1 - parseFloat(noBook.data.last_trade_price || "1");

    const lastTradePrice =
        Math.abs(noLastInverted - mid) < Math.abs(yesLast - mid)
            ? noLastInverted.toFixed(4)
            : yesBook.data.last_trade_price;

    return {
        ...yesBook.data,
        bids: combinedBids,
        asks: combinedAsks,
        last_trade_price: lastTradePrice,
    };
}

export async function fetchPriceHistory(conditionId: string, interval = "all", fidelity = 60) {
    const market = await Market.findOne(
        { conditionId },
        { "tokens.Yes.tokenId": 1 },
    ).lean();
    if (!market) return null;

    const { data } = await axios.get(`${CLOB_API}/prices-history`, {
        params: { market: market.tokens.Yes.tokenId, interval, fidelity },
    });

    return data;
}
