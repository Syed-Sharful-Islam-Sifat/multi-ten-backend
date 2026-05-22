
import mongoose, { Document, Schema } from 'mongoose';

export interface ICompany extends Document {
  name:       string;
  email:      string;
  isVerified: boolean;
  createdAt:  Date;
  updatedAt:  Date;
}

const companySchema = new Schema<ICompany>(
  {
    name:       { type: String,  required: true, trim: true, minlength: 2, maxlength: 255 },
    email:      { type: String,  required: true, trim: true, lowercase: true },
    isVerified: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, versionKey: false },
);

companySchema.index({ email: 1 }, { unique: true });

export const Company = mongoose.model<ICompany>('Company', companySchema);