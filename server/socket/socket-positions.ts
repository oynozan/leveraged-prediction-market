import { SocketListener } from "../socket";
import Position from "../models/Positions";

export class SocketPositions extends SocketListener {
    listen() {
        this.socket.on("subscribe:positions", async () => {
            const wallet = this.socket.user?.wallet;
            if (!wallet) return;

            this.socket.join(`wallet:${wallet}`);

            try {
                const positions = await Position.find({ wallet, status: "open" })
                    .sort({ createdAt: -1 })
                    .lean();
                this.socket.emit("positions:update", positions);
            } catch (err) {
                console.error("[socket-positions] Error fetching positions:", err);
            }
        });

        this.socket.on("disconnect", () => {
            const wallet = this.socket.user?.wallet;
            if (wallet) this.socket.leave(`wallet:${wallet}`);
        });
    }
}
