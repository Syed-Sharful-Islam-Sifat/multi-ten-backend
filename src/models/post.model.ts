import mongoose, { Document, Schema, Types } from 'mongoose';

export type PostVisibility = 'public' | 'private';

export interface IPost extends Document {
  author: Types.ObjectId;
  content: string;
  image?: string;
  visibility: PostVisibility;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<IPost>(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, maxlength: 2000, trim: true },
    image: { type: String },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);
// here index has created on visibility and post id creating index on 
// visibility and _id allows to fetch public post in newest order very fast.

// without index on visibility mongodb will scan each document
//_id: 9  visibility: public   ✓ return
// _id: 8  visibility: private  ✗ skip
// _id: 7  visibility: public   ✓ return
// _id: 6  visibility: private  ✗ skip
// ...scans entire collection

//with visibility
// [private, _id:5]
// [private, _id:3]
// [public,  _id:9]  ← MongoDB jumps here directly
// [public,  _id:7]
// [public,  _id:4]
// [public,  _id:2]
postSchema.index({ visibility: 1, _id: -1 });
postSchema.index({ author: 1, _id: -1 });

export const Post = mongoose.model<IPost>('Post', postSchema);
