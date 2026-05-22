
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IWorkspace extends Document {
  companyId:   Types.ObjectId;
  createdBy:   Types.ObjectId;
  name:        string;
  description: string;
  createdAt:   Date;
  updatedAt:   Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    companyId:   { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy:   { type: Schema.Types.ObjectId, ref: 'User',    required: true },
    name:        { type: String, required: true, trim: true, minlength: 1, maxlength: 255 },
    description: { type: String, default: '', trim: true, maxlength: 1000 },
  },
  { timestamps: true, versionKey: false },
);

// All workspace queries are always scoped to a company
workspaceSchema.index({ companyId: 1 });
workspaceSchema.index({ companyId: 1, name: 1 });

export const Workspace = mongoose.model<IWorkspace>('Workspace', workspaceSchema);