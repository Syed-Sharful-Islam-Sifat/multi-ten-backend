
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface INoteHistory extends Document {
  noteId:          Types.ObjectId;
  changedBy:       Types.ObjectId;
  previousTitle:   string;
  previousContent: string;
  createdAt:       Date;
}

const noteHistorySchema = new Schema<INoteHistory>(
  {
    noteId:          { type: Schema.Types.ObjectId, ref: 'Note', required: true },
    changedBy:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    previousTitle:   { type: String, required: true },
    previousContent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// History view: all snapshots for a note ordered newest first
noteHistorySchema.index({ noteId: 1, createdAt: -1 });

// TTL: 604800 seconds = 7 days
// MongoDB auto-deletes document when createdAt + 7d is in the past
noteHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

export const NoteHistory = mongoose.model<INoteHistory>('NoteHistory', noteHistorySchema);