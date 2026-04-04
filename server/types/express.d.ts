import type { IUserDocument } from "../models/Users";

declare global {
    namespace Express {
        interface Request {
            user?: IUserDocument;
        }
    }
}

export {};
