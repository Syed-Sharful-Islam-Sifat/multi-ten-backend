// ============================================================
// models/LoginOtp.ts
//
// Stores bcrypt hash of 6-digit OTP — raw code never persisted.
// TTL index auto-deletes expired OTPs — no cron needed.
// attempts counter prevents brute force on a specific token.
// isUsed flag burns the token after first successful verification.
// ============================================================
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ILoginOtp extends Document {
  userId:    Types.ObjectId;
  email:     string;
  otpHash:   string;
  expiresAt: Date;
  isUsed:    boolean;
  attempts:  number;
  createdAt: Date;
}

const loginOtpSchema = new Schema<ILoginOtp>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    email:     { type: String,  required: true, lowercase: true },
    otpHash:   { type: String,  required: true },
    expiresAt: { type: Date,    required: true },
    isUsed:    { type: Boolean, default: false },
    attempts:  { type: Number,  default: 0, min: 0, max: 5 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// OTP verification lookup — userId + isUsed filters to active tokens only
loginOtpSchema.index({ userId: 1, isUsed: 1 });

// TTL: auto-delete when expiresAt is in the past (expireAfterSeconds: 0
// means "delete exactly when the date stored in the field is reached")
loginOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginOtp = mongoose.model<ILoginOtp>('LoginOtp', loginOtpSchema);