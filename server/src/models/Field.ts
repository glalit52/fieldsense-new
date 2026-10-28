import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const soilTestSchema = new Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    ph: { type: Number, min: 3, max: 10.5 },
    organicCarbon: { type: Number, min: 0, max: 30 },
    clay: { type: Number, min: 0, max: 100 },
    p: { type: Number, min: 0, max: 1000 },
    k: { type: Number, min: 0, max: 5000 },
    notes: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const fieldSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lon: { type: Number, required: true, min: -180, max: 180 },
    /** Outline as [lon, lat] pairs; absent for a pin. */
    polygon: { type: [[Number]], default: undefined },
    notes: { type: String, default: "", maxlength: 4000 },
    /** Headline numbers from the last check, for the fields list. */
    summary: { type: Schema.Types.Mixed, default: null },
    tests: { type: [soilTestSchema], default: [] },
  },
  { timestamps: true },
);
fieldSchema.index({ userId: 1, updatedAt: -1 });

export type FieldDoc = InferSchemaType<typeof fieldSchema>;
export const Field: Model<FieldDoc> = mongoose.models.Field ?? mongoose.model("Field", fieldSchema);
