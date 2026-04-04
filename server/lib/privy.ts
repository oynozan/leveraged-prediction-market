import { PrivyClient } from "@privy-io/server-auth";
import type { Request } from "express";

const privy = new PrivyClient(
    process.env.PRIVY_APP_ID!,
    process.env.PRIVY_APP_SECRET!,
);

export interface PrivyUser {
    wallet: string;
    id: string;
    email?: string;
}

export async function getUser(idToken: string | null): Promise<PrivyUser | null> {
    if (!idToken) return null;
    try {
        const user = await privy.getUser({ idToken });
        const wallet = user.wallet?.address;
        if (!wallet) return null;
        return {
            wallet,
            id: user.id,
            email: user.email?.address,
        };
    } catch {
        return null;
    }
}

export function getIdTokenFromHeaders(req: Request): string | null {
    const token = req.headers["privy-id-token"];
    return typeof token === "string" ? token : null;
}
