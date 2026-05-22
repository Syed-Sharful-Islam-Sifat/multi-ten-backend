import { Request, Response, NextFunction } from 'express';
import * as PostService from '../services/post.service';
import * as CommentService from '../services/comment.service';

export async function getFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const result = await PostService.getFeed({ cursor }, req.currentUser?._id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function createPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const post = await PostService.createPost(req.currentUser!._id, req.body, req.file);
    res.status(201).json({ success: true, data: post, message: 'Post created successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getPost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const post = await PostService.getPost(req.params.id, req.currentUser?._id);
    res.status(200).json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
}

export async function deletePost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await PostService.deletePost(req.params.id, req.currentUser!._id);
    res.status(200).json({ success: true, message: 'Post deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function updatePost(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const post = await PostService.updatePost(req.params.id, req.currentUser!._id, req.body);
    res.status(200).json({ success: true, data: post, message: 'Post updated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getComments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const result = await CommentService.getComments(req.params.id, cursor, req.currentUser?._id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function createComment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const comment = await CommentService.createComment(
      req.params.id,
      req.currentUser!._id,
      req.body,
    );
    res.status(201).json({ success: true, data: comment, message: 'Comment added' });
  } catch (err) {
    next(err);
  }
}
