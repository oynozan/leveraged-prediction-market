"use client";

import { useState, useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { io, type Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL!;

interface TradeProgress {
    step: number;
    total: number;
    label: string;
}

export function useTradeProgress(active: boolean) {
    const [progress, setProgress] = useState<TradeProgress | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const { authenticated, getAccessToken } = usePrivy();

    useEffect(() => {
        if (!active || !authenticated) {
            setProgress(null);
            return;
        }

        let cancelled = false;

        async function connect() {
            try {
                const token = await getAccessToken();
                if (cancelled || !token) return;

                const socket = io(SOCKET_URL, {
                    transports: ["websocket"],
                    auth: { token },
                });

                socketRef.current = socket;

                socket.on("connect", () => {
                    socket.emit("subscribe:positions");
                });

                socket.on("trade:progress", (data: TradeProgress) => {
                    setProgress(data);
                });
            } catch {
                /* ignore connection errors */
            }
        }

        connect();

        return () => {
            cancelled = true;
            setProgress(null);
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [active, authenticated, getAccessToken]);

    return progress;
}
