import mongoose, { FilterQuery } from 'mongoose';
import { Post, IPost } from '../models/post.model';
import { Comment } from '../models/comment.model';
import { Like } from '../models/like.model';
import { ApiError } from '../lib/errors';
import { uploadImage } from '../lib/cloudinary';
import type { CreatePostInput, UpdatePostInput } from '../schemas/post.schema';

const DEFAULT_LIMIT = 20;

interface FeedQuery {
  cursor?: string;
  limit?: number;
}

interface AuthorRef {
  _id: unknown;
  firstName: string;
  lastName: string;
  avatar?: string;
}

interface PostShape {
  _id: unknown;
  author: AuthorRef | unknown;
  content: string;
  image?: string;
  visibility: 'public' | 'private';
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface FeedResult {
  posts: PostShape[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function getFeed(query: FeedQuery, currentUserId?: string): Promise<FeedResult> {

   /*
   core thinking:

   hard limit is used to prevent abuse from the client,
   for current user all the public posts and user's own posts can be seen,
   
   Used cursor based pagination as offset means scan each document which is unnecessary, 
   cursor directly jumps to the cursor_id and fetches next documents.

   populate is used to get author details in single query, without
   populate its a n+1 query problem
   
   used single query to get all the post_id user has liked,
   first we get all the post ids and given those post ids to the like collection out of those posts
   which are liked by the user and later just check if particular post is on likedPostSet
   
  */
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, 50);// need a default limit to prevent abuse from the client
  const visibilityFilter = currentUserId
    ? { $or: [{ visibility: 'public' }, { author: currentUserId }] }
    : { visibility: 'public' };

  const filter: FilterQuery<IPost> = { ...visibilityFilter };

  if (query.cursor) {
    if (!mongoose.Types.ObjectId.isValid(query.cursor)) {
      throw new ApiError(400, 'Invalid cursor');
    }
    filter._id = { $lt: new mongoose.Types.ObjectId(query.cursor) };
  }

 
  const posts = await Post.find(filter)
    .populate('author', 'firstName lastName avatar')
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = posts.length > limit;
  const page = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? String(page[page.length - 1]._id) : null;

 
  const postIds = page.map((p) => p._id);
  const userLikes = currentUserId
    ? await Like.find({ userId: currentUserId, targetId: { $in: postIds }, targetType: 'post' })
        .select('targetId')
        .lean()
    : [];

  const likedSet = new Set(userLikes.map((l) => String(l.targetId)));

  const result: PostShape[] = page.map((post) => ({
    ...(post as object),
    likedByMe: likedSet.has(String(post._id)),
  })) as PostShape[];

  return { posts: result, nextCursor, hasMore };
}

export async function createPost(
  authorId: string,
  input: CreatePostInput,
  file?: Express.Multer.File,
): Promise<object | null> {
  let image: string | undefined;
  if (file) {
    try {
      image = await uploadImage(file.buffer);
    } catch {
      throw new ApiError(503, 'Image upload failed. Please try again.');
    }
  }
  const post = await Post.create({
    author: authorId,
    content: input.content,
    visibility: input.visibility,
    ...(image && { image }),
  });
  return Post.findById(post._id).populate('author', 'firstName lastName avatar').lean();
}

export async function getPost(id: string, currentUserId?: string): Promise<object> {
 
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Post not found');

  const post = await Post.findById(id)
    .populate('author', 'firstName lastName avatar')
    .lean();
  if (!post) throw new ApiError(404, 'Post not found');

  
  if (post.visibility === 'private' && String(post.author) !== currentUserId) {
    throw new ApiError(404, 'Post not found');
  }

  const likedByMe = currentUserId
    ? !!(await Like.exists({ userId: currentUserId, targetId: post._id, targetType: 'post' }))
    : false;

  return { ...post, likedByMe };
}

export async function deletePost(id: string, currentUserId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Post not found');

  const post = await Post.findById(id).lean();
  if (!post) throw new ApiError(404, 'Post not found');
  
  if (String(post.author) !== currentUserId) throw new ApiError(404, 'Post not found');
  
  // here promise.all is used to run all the operations parallelly as they are independent,
  //otherwise  it will take more time 
  await Promise.all([
    Post.deleteOne({ _id: id }),
    Comment.deleteMany({ postId: id }),
    Like.deleteMany({ postId: id }),
  ]);
}

export async function updatePost(
  id: string,
  currentUserId: string,
  input: UpdatePostInput,
): Promise<object | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(404, 'Post not found');

  const post = await Post.findById(id).lean();
  if (!post) throw new ApiError(404, 'Post not found');
  if (String(post.author) !== currentUserId) throw new ApiError(404, 'Post not found');

  const updates: Record<string, unknown> = { content: input.content };
  if (input.visibility) updates.visibility = input.visibility;

  return Post.findByIdAndUpdate(id, updates, { new: true })
    .populate('author', 'firstName lastName avatar')
    .lean();
}
