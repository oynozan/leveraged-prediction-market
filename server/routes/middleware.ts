import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

import { getKey } from "../lib/utils";
import { getUser, getIdTokenFromHeaders } from "../lib/privy";

/**
 * Server-to-server token verification middleware
 */
export const verifyServerToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid token" });
        return;
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(
        token,
        getKey(),
        {
            algorithms: ["ES256"],
            issuer: process.env.JWT_ISSUER!,
        },
        err => {
            if (err) {
                return res.status(403).json({ error: "Invalid or expired token" });
            }
            next();
        },
    );
};

/**
 * Privy user token verification middleware
 * Reads privy-id-token from headers, verifies via Privy, and sets req.user
 */
export const userToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const idToken = getIdTokenFromHeaders(req);
    if (idToken) {
        const user = await getUser(idToken);
        if (user) {
            req.user = user;
        }
    }
    next();
};

export const authRequired = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
};
