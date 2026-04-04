import { SocketAuthentication } from "./index";
import type { Socket, Server } from "socket.io";

// Listener imports
import { SocketPing } from "./socket-ping";
import { SocketMarketData } from "./socket-market-data";
import { SocketPositions } from "./socket-positions";
import { setIO } from "./broadcast";

export class SocketListeners {
    private io: Server;

    constructor(io: Server) {
        this.io = io;
        setIO(io);

        this.protectedListeners();
        this.publicListeners();
        this.marketDataListeners();
    }

    protectedListeners() {
        const protectedIO = this.io.of("/protected");
        SocketAuthentication.serverOnlyAuthenticationMiddleware(protectedIO);

        // On-connection listeners
        protectedIO.on("connection", (socket: Socket) => {
            new SocketPing(protectedIO, socket).listen();
        });
    }

    publicListeners() {
        const publicIO = SocketAuthentication.authenticationMiddleware(this.io);

        // On-connection listeners
        publicIO.on("connection", (socket: Socket) => {
            new SocketPing(this.io, socket).listen();
            new SocketPositions(this.io, socket).listen();
        });
    }

    marketDataListeners() {
        const marketsIO = this.io.of("/markets");

        marketsIO.on("connection", (socket: Socket) => {
            console.log(`[market-data] client connected: ${socket.id}`);
            new SocketMarketData(marketsIO, socket).listen();
        });
    }
}
