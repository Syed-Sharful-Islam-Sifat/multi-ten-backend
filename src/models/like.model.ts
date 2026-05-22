import mongoose, { Document, Schema, Types } from 'mongoose';

export type LikeTargetType = 'post' | 'comment';

export interface ILike extends Document {
  userId: Types.ObjectId;
  targetId: Types.ObjectId;
  targetType: LikeTargetType;
  postId: Types.ObjectId;
  parentCommentId?: Types.ObjectId;
  createdAt: Date;
}

const likeSchema = new Schema<ILike>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    targetType: { type: String, enum: ['post', 'comment'], required: true },
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    parentCommentId: { type: Schema.Types.ObjectId, ref: 'Comment' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

likeSchema.index({ userId: 1, targetId: 1, targetType: 1 }, { unique: true });
likeSchema.index({ targetId: 1, targetType: 1 });
likeSchema.index({ postId: 1 });
likeSchema.index({ parentCommentId: 1 });

export const Like = mongoose.model<ILike>('Like', likeSchema);
