import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/** One archived field check: the history view's snapshot plus the full report, gzipped. */
const fieldCheckSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    fieldId: { type: Schema.Types.ObjectId, ref: "Field", required: true },
    checkedAt: { type: Date, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    report: { type: Buffer, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
fieldCheckSchema.index({ fieldId: 1, userId: 1, checkedAt: -1 });

export type FieldCheckDoc = InferSchemaType<typeof fieldCheckSchema>;
export const FieldCheck: Model<FieldCheckDoc> = mongoose.models.FieldCheck ?? mongoose.model("FieldCheck", fieldCheckSchema);
