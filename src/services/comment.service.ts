import mongoose, { FilterQuery } from 'mongoose';
import { Comment, IComment } from '../models/comment.model';
import { Post } from '../models/post.model';
import { Like } from '../models/like.model';
import { ApiError } from '../lib/errors';
import type { CreateCommentInput } from '../schemas/comment.schema';

const DEFAULT_LIMIT = 20;

interface CommentShape {
  _id: unknown;
  postId: unknown;
  author: unknown;
  content: string;
  parentId: unknown;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PageResult {
  comments?: CommentShape[];
  replies?: CommentShape[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function getComments(
  postId: string,
  cursor: string | undefined,
  currentUserId?: string,
): Promise<PageResult> {
  if (!mongoose.Types.ObjectId.isValid(postId)) throw new ApiError(404, 'Post not found');

  const filter: FilterQuery<IComment> = { postId, parentId: null };
  if (cursor) {
    if (!mongoose.Types.ObjectId.isValid(cursor)) throw new ApiError(400, 'Invalid cursor');
    filter._id = { $gt: new mongoose.Types.ObjectId(cursor) };
  }

  const limit = DEFAULT_LIMIT;
  const docs = await Comment.find(filter)
    .populate('author', 'firstName lastName avatar')
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;

  const ids = page.map((c) => c._id);
  const userLikes = currentUserId
    ? await Like.find({ userId: currentUserId, targetId: { $in: ids }, targetType: 'comment' })
        .select('targetId')
        .lean()
    : [];

  const likedSet = new Set(userLikes.map((l) => String(l.targetId)));

  return {
    comments: page.map((c) => ({
      ...(c as object),
      likedByMe: likedSet.has(String(c._id)),
    })) as CommentShape[],
    nextCursor,
    hasMore,
  };
}

export async function createComment(
  postId: string,
  authorId: string,
  input: CreateCommentInput,
): Promise<object | null> {
  if (!mongoose.Types.ObjectId.isValid(postId)) throw new ApiError(404, 'Post not found');

  const post = await Post.exists({ _id: postId });
  if (!post) throw new ApiError(404, 'Post not found');

  const [comment] = await Promise.all([
    Comment.create({ postId, author: authorId, content: input.content, parentId: null }),
    Post.updateOne({ _id: postId }, { $inc: { commentCount: 1 } }),
  ]);

  return Comment.findById(comment._id)
    .populate('author', 'firstName lastName avatar')
    .lean();
}

export async function deleteComment(id: string, currentUserId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Comment not found');

  const comment = await Comment.findById(id).lean();
  if (!comment) throw new ApiError(404, 'Comment not found');
  if (String(comment.author) !== currentUserId) throw new ApiError(404, 'Comment not found');
  if (comment.parentId !== null) throw new ApiError(400, 'Use the reply delete endpoint');

  await Promise.all([
    Comment.deleteOne({ _id: id }),
    Comment.deleteMany({ parentId: id }),
    Like.deleteMany({ $or: [{ targetId: id }, { parentCommentId: id }] }),
    Post.updateOne({ _id: comment.postId }, { $inc: { commentCount: -1 } }),
  ]);
}

export async function getReplies(
  commentId: string,
  cursor: string | undefined,
  currentUserId?: string,
): Promise<PageResult> {
  if (!mongoose.Types.ObjectId.isValid(commentId)) throw new ApiError(404, 'Comment not found');

  const filter: FilterQuery<IComment> = { parentId: commentId };
  if (cursor) {
    if (!mongoose.Types.ObjectId.isValid(cursor)) throw new ApiError(400, 'Invalid cursor');
    filter._id = { $gt: new mongoose.Types.ObjectId(cursor) };
  }

  const limit = DEFAULT_LIMIT;
  const docs = await Comment.find(filter)
    .populate('author', 'firstName lastName avatar')
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;

  const ids = page.map((r) => r._id);
  const userLikes = currentUserId
    ? await Like.find({ userId: currentUserId, targetId: { $in: ids }, targetType: 'comment' })
        .select('targetId')
        .lean()
    : [];

  const likedSet = new Set(userLikes.map((l) => String(l.targetId)));

  return {
    replies: page.map((r) => ({
      ...(r as object),
      likedByMe: likedSet.has(String(r._id)),
    })) as CommentShape[],
    nextCursor,
    hasMore,
  };
}

export async function createReply(
  commentId: string,
  authorId: string,
  input: CreateCommentInput,
): Promise<object | null> {
  if (!mongoose.Types.ObjectId.isValid(commentId)) throw new ApiError(404, 'Comment not found');

  const parent = await Comment.findById(commentId).lean();
  if (!parent) throw new ApiError(404, 'Comment not found');
  if (parent.parentId !== null) throw new ApiError(400, 'Cannot reply to a reply');

  const [reply] = await Promise.all([
    Comment.create({
      postId: parent.postId,
      author: authorId,
      content: input.content,
      parentId: commentId,
    }),
    Comment.updateOne({ _id: commentId }, { $inc: { replyCount: 1 } }),
  ]);

  return Comment.findById(reply._id)
    .populate('author', 'firstName lastName avatar')
    .lean();
}

export async function deleteReply(id: string, currentUserId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Reply not found');

  const reply = await Comment.findById(id).lean();
  if (!reply) throw new ApiError(404, 'Reply not found');
  if (String(reply.author) !== currentUserId) throw new ApiError(404, 'Reply not found');
  if (reply.parentId === null) throw new ApiError(400, 'Use the comment delete endpoint');

  await Promise.all([
    Comment.deleteOne({ _id: id }),
    Like.deleteMany({ targetId: id, targetType: 'comment' }),
    Comment.updateOne({ _id: reply.parentId }, { $inc: { replyCount: -1 } }),
  ]);
}
