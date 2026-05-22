import mongoose from 'mongoose';
import { Like, LikeTargetType } from '../models/like.model';
import { Post } from '../models/post.model';
import { Comment } from '../models/comment.model';
import { User } from '../models/user.model';
import { ApiError } from '../lib/errors';

interface LikeContext {
  postId: mongoose.Types.ObjectId;
  parentCommentId?: mongoose.Types.ObjectId;
}

async function resolveLikeContext(targetId: string, targetType: LikeTargetType): Promise<LikeContext> {
  if (targetType === 'post') {
    const post = await Post.findById(targetId).select('_id').lean();
    if (!post) throw new ApiError(404, 'Post not found');
    return { postId: post._id as mongoose.Types.ObjectId };
  }

  const comment = await Comment.findById(targetId).select('postId parentId').lean();
  if (!comment) throw new ApiError(404, 'Comment not found');
  return {
    postId: comment.postId as mongoose.Types.ObjectId,
    ...(comment.parentId && { parentCommentId: comment.parentId as mongoose.Types.ObjectId }),
  };
}

async function incrementLikeCount(targetId: string, targetType: LikeTargetType, delta: 1 | -1): Promise<number> {
  if (targetType === 'post') {
    await Post.updateOne({ _id: targetId }, { $inc: { likeCount: delta } });
    const doc = await Post.findById(targetId).select('likeCount').lean();
    return doc?.likeCount ?? 0;
  } else {
    await Comment.updateOne({ _id: targetId }, { $inc: { likeCount: delta } });
    const doc = await Comment.findById(targetId).select('likeCount').lean();
    return doc?.likeCount ?? 0;
  }
}

export async function toggleLike(
  targetId: string,
  targetType: LikeTargetType,
  userId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new ApiError(404, targetType === 'post' ? 'Post not found' : 'Comment not found');
  }

  const ctx = await resolveLikeContext(targetId, targetType);

  const existing = await Like.findOne({ userId, targetId, targetType }).lean();

  if (existing) {
    await Like.deleteOne({ _id: existing._id });
    const likeCount = await incrementLikeCount(targetId, targetType, -1);
    return { liked: false, likeCount };
  }

  await Like.create({ userId, targetId, targetType, postId: ctx.postId, ...(ctx.parentCommentId && { parentCommentId: ctx.parentCommentId }) });
  const likeCount = await incrementLikeCount(targetId, targetType, 1);
  return { liked: true, likeCount };
}

export async function getLikes(
  targetId: string,
  targetType: LikeTargetType,
): Promise<{ _id: string; firstName: string; lastName: string; avatar?: string }[]> {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new ApiError(404, targetType === 'post' ? 'Post not found' : 'Comment not found');
  }

  await resolveLikeContext(targetId, targetType);

  const likes = await Like.find({ targetId, targetType })
    .sort({ createdAt: -1 })
    .limit(100)
    .select('userId')
    .lean();

  const userIds = likes.map((l) => l.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select('firstName lastName avatar')
    .lean();

  return users.map((u) => ({
    _id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    avatar: u.avatar,
  }));
}
