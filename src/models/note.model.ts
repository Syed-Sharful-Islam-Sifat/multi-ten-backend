// ============================================================
// models/Note.ts
//
// Two independent axes drive visibility:
//
//   noteType : 'private' | 'public'
//     private → only company members can see it
//     public  → streams into global public directory once published
//
//   isDraft : true | false
//     true  → hidden from all listings (author only)
//     false → visible according to noteType rules
//
// Visibility matrix:
//   private + isDraft:true  → author only
//   private + isDraft:false → all company members
//   public  + isDraft:true  → author only (never in public directory)
//   public  + isDraft:false → global public directory
//
// companyId denormalized from workspace:
//   Every tenant isolation check hits notes directly — no $lookup.
//
// votesCache:
//   Denormalized SUM of noteVotes.value.
//   Updated atomically via $inc on every vote write.
//   Avoids aggregation pipeline on public listing pages.
//
// publishedAt:
//   Set ONCE on first publish — never updated again.
//   Prevents gaming "sort by new" via trivial edits.
// ============================================================
import mongoose, { Document, Schema, Types } from 'mongoose';

export interface INote extends Document {
  workspaceId: Types.ObjectId;
  companyId:   Types.ObjectId;
  createdBy:   Types.ObjectId;
  title:       string;
  content:     string;
  tags:        string[];
  noteType:    'private' | 'public';
  isDraft:     boolean;
  publishedAt: Date | null;
  votesCache:  number;
  createdAt:   Date;
  updatedAt:   Date;
}

const noteSchema = new Schema<INote>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    companyId:   { type: Schema.Types.ObjectId, ref: 'Company',   required: true },
    createdBy:   { type: Schema.Types.ObjectId, ref: 'User',      required: true },
    title:       { type: String,  required: true, trim: true, minlength: 1, maxlength: 500 },
    content:     { type: String,  default: '' },
    tags:        { type: [String], default: [] },
    noteType:    { type: String,  enum: ['private', 'public'], default: 'private', required: true },
    isDraft:     { type: Boolean, default: true, required: true },
    publishedAt: { type: Date,    default: null },
    votesCache:  { type: Number,  default: 0 },
  },
  { timestamps: true, versionKey: false },
);

// --- Internal: company workspace listing + draft filter ---
noteSchema.index({ companyId: 1, workspaceId: 1, isDraft: 1 });

// --- Internal: title prefix search inside a workspace ---
noteSchema.index({ companyId: 1, workspaceId: 1, title: 1 });

// --- Public directory: sort by newest published ---
noteSchema.index({ noteType: 1, isDraft: 1, publishedAt: -1 });

// --- Public directory: sort by most / least votes ---
noteSchema.index({ noteType: 1, isDraft: 1, votesCache: -1 });

// --- Public directory: title prefix search ---
noteSchema.index({ noteType: 1, isDraft: 1, title: 1 });

// --- Public directory: filter by tag (multikey — one entry per tag string) ---
noteSchema.index({ noteType: 1, isDraft: 1, tags: 1 });

export const Note = mongoose.model<INote>('Note', noteSchema);