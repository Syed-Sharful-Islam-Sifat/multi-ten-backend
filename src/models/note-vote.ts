
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface INoteVote extends Document {
  noteId:         Types.ObjectId;
  voterCompanyId: Types.ObjectId;
  value:          1 | -1;
  createdAt:      Date;
}

const noteVoteSchema = new Schema<INoteVote>(
  {
    noteId:         { type: Schema.Types.ObjectId, ref: 'Note',    required: true },
    voterCompanyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    value:          { type: Number, enum: [1, -1], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// Core constraint: one vote per company per note — enforced at DB level
noteVoteSchema.index({ noteId: 1, voterCompanyId: 1 }, { unique: true });

// Fetch existing vote before calculating delta
noteVoteSchema.index({ noteId: 1 });

export const NoteVote = mongoose.model<INoteVote>('NoteVote', noteVoteSchema);