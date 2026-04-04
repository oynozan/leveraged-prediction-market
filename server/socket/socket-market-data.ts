import { SocketListener } from "../socket";
import { fetchMergedBook } from "../services/polymarket";

const BOOK_INTERVAL_MS = 3000;

export class SocketMarketData extends SocketListener {
    private bookInterval: ReturnType<typeof setInterval> | null = null;
    private subscribedConditionId: string | null = null;

    listen() {
        this.socket.on("subscribe:book", (conditionId: string) => {
            this.cleanup();
            this.subscribedConditionId = conditionId;

            console.log(`[market-data] ${this.socket.id} subscribed to book: ${conditionId}`);

            this.pollBook(conditionId);
            this.bookInterval = setInterval(() => this.pollBook(conditionId), BOOK_INTERVAL_MS);
        });

        this.socket.on("unsubscribe:book", () => {
            console.log(`[market-data] ${this.socket.id} unsubscribed from book`);
            this.cleanup();
        });

        this.socket.on("disconnect", () => {
            console.log(`[market-data] ${this.socket.id} disconnected, cleaning up`);
            this.cleanup();
        });
    }

    private async pollBook(conditionId: string) {
        try {
            const book = await fetchMergedBook(conditionId);
            if (!book) return;

            this.socket.emit("book:update", book);
            console.log(
                `[market-data] emitted book:update for ${conditionId} → ` +
                `bids=${book.bids.length} asks=${book.asks.length} last=${book.last_trade_price}`,
            );
        } catch (err) {
            console.error(`[market-data] poll error for ${conditionId}:`, err);
        }
    }

    private cleanup() {
        if (this.bookInterval) {
            clearInterval(this.bookInterval);
            this.bookInterval = null;
        }
        this.subscribedConditionId = null;
    }
}
