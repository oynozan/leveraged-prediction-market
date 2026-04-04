import mongoose, { Schema, type Model, type Document, Types } from "mongoose";

export interface IPosition {
    user: Types.ObjectId;
    conditionId: string;
    outcome: "Yes" | "No";
    leverage: string;
    shares: number;
    entryPrice: number;
    positionValue: number;
    liqPrice: number;
    status: "open" | "closed";
}

export interface IPositionDocument extends IPosition, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const PositionSchema = new Schema<IPositionDocument>(
    {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        conditionId: { type: String, required: true },
        outcome: { type: String, enum: ["Yes", "No"], required: true },
        leverage: { type: String, required: true },
        shares: { type: Number, required: true },
        entryPrice: { type: Number, required: true },
        positionValue: { type: Number, required: true },
        liqPrice: { type: Number, required: true },
        status: { type: String, enum: ["open", "closed"], default: "open" },
    },
    { timestamps: true, versionKey: false },
);

export const Position: Model<IPositionDocument> =
    mongoose.models.Position || mongoose.model<IPositionDocument>("Position", PositionSchema);

export default Position;
