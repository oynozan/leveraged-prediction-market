"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { formatUnits } from "viem";
import { getMarginBalance } from "@/lib/api";
import { usePrivy } from "@privy-io/react-auth";
import { io, type Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL!;

export function useUsdcBalance(address: string | undefined) {
    const [balance, setBalance] = useState<string | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const { authenticated, getAccessToken } = usePrivy();

    const fetchBalance = useCallback(async () => {
        if (!address) return;
        try {
            const margin = await getMarginBalance(address);
            setBalance(formatUnits(BigInt(margin.available), 6));
        } catch {
            /* ignore */
        }
    }, [address]);

    useEffect(() => {
        if (!address || !authenticated) return;

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

                socket.on("margin:update", (margin: { available: string }) => {
                    setBalance(formatUnits(BigInt(margin.available), 6));
                });

                socket.on("connect_error", () => {
                    fetchBalance();
                });
            } catch {
                fetchBalance();
            }
        }

        fetchBalance();
        connect();

        return () => {
            cancelled = true;
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [address, authenticated, getAccessToken, fetchBalance]);

    useEffect(() => {
        const handler = () => fetchBalance();

        window.addEventListener("balance:update", handler);
        window.addEventListener("position:created", handler);
        window.addEventListener("position:closed", handler);
        return () => {
            window.removeEventListener("balance:update", handler);
            window.removeEventListener("position:created", handler);
            window.removeEventListener("position:closed", handler);
        };
    }, [fetchBalance]);

    if (!address) return null;
    return balance;
}
