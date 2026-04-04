import mongoose, { Schema, type Model, type Document, Types } from "mongoose";

export interface IPosition {
    wallet: string;
    conditionId: string;
    outcome: "Yes" | "No";
    leverage: string;
    shares: number;
    entryPrice: number;
    positionValue: number;
    marginAmount: number;
    borrowedAmount: number;
    liqPrice: number;
    status: "open" | "closed";
    settled: boolean;
    question?: string;
    slug?: string;
    orderId?: string;
}

export interface IPositionDocument extends IPosition, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const PositionSchema = new Schema<IPositionDocument>(
    {
        wallet: { type: String, required: true, index: true },
        conditionId: { type: String, required: true },
        outcome: { type: String, enum: ["Yes", "No"], required: true },
        leverage: { type: String, required: true },
        shares: { type: Number, required: true },
        entryPrice: { type: Number, required: true },
        positionValue: { type: Number, required: true },
        marginAmount: { type: Number, required: true, default: 0 },
        borrowedAmount: { type: Number, required: true, default: 0 },
        liqPrice: { type: Number, required: true },
        status: { type: String, enum: ["open", "closed"], default: "open" },
        settled: { type: Boolean, default: false },
        question: { type: String },
        slug: { type: String },
        orderId: { type: String },
    },
    { timestamps: true, versionKey: false },
);

export const Position: Model<IPositionDocument> =
    mongoose.models.Position || mongoose.model<IPositionDocument>("Position", PositionSchema);

export default Position;
