
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IUser extends Document {
  companyId: Types.ObjectId;
  name:      string;
  email:     string;
  role:      'owner' | 'member';
  isActive:  boolean;
  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    name:      { type: String,  required: true, trim: true, minlength: 1, maxlength: 255 },
    email:     { type: String,  required: true, trim: true, lowercase: true },
    role:      { type: String,  enum: ['owner', 'member'], required: true },
    isActive:  { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);


userSchema.index({ companyId: 1, email: 1 }, { unique: true });
userSchema.index({ companyId: 1 });

export const User = mongoose.model<IUser>('User', userSchema);