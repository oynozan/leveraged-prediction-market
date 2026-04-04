declare global {
    namespace Express {
        interface Request {
            user?: {
                wallet: string;
                id: string;
                email?: string;
            };
        }
    }
}

export {};
