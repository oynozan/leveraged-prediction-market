import jwt from "jsonwebtoken";
import type { Server as HTTPServer } from "http";
import { type Namespace, Server, type Socket } from "socket.io";

import { getKey } from "../lib/utils";
import { getUser } from "../lib/privy";

export function socketServer(server: HTTPServer) {
    const io = new Server(server, {
        cors: { origin: "*" },
    });

    console.log("socket.io server is running");
    return io;
}

export abstract class SocketListener {
    protected io: Server | Namespace;
    protected socket: Socket;

    constructor(io: Server | Namespace, socket: Socket) {
        if (!io || !socket) {
            throw new Error("socket.io server or socket is not initialized");
        }

        this.io = io;
        this.socket = socket;
    }
}

export class SocketAuthentication {
    public static authenticationMiddleware(io: Server) {
        io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth?.token;
                if (!token) return next(new Error("Unauthorized"));

                const user = await getUser(token);
                if (!user) return next(new Error("Forbidden"));

                socket.user = user;
                next();
            } catch (e) {
                console.error(e);
                next(new Error("Forbidden"));
            }
        });
        return io;
    }

    public static serverOnlyAuthenticationMiddleware(io: Namespace) {
        io.use((socket, next) => {
            try {
                const token = socket.handshake.auth?.token;
                if (!token) return next(new Error("Unauthorized"));

                jwt.verify(token, getKey(), {
                    algorithms: ["ES256"],
                    issuer: process.env.JWT_ISSUER!,
                });

                next();
            } catch (e) {
                console.error(e);
                next(new Error("Forbidden"));
            }
        });
        return io;
    }
}
