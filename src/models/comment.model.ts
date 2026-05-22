import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IComment extends Document {
  postId: Types.ObjectId;
  author: Types.ObjectId;
  content: string;
  parentId: Types.ObjectId | null;
  likeCount: number;
  replyCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, maxlength: 500, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Comment', default: null },
    likeCount: { type: Number, default: 0, min: 0 },
    replyCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false },
);

commentSchema.index({ postId: 1, parentId: 1, createdAt: 1 });
commentSchema.index({ parentId: 1, createdAt: 1 });

export const Comment = mongoose.model<IComment>('Comment', commentSchema);
