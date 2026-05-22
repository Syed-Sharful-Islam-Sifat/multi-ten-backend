import { Request, Response, NextFunction } from 'express';
import * as CommentService from '../services/comment.service';

export async function deleteComment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await CommentService.deleteComment(req.params.id, req.currentUser!._id);
    res.status(200).json({ success: true, message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
}

export async function getReplies(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const result = await CommentService.getReplies(req.params.id, cursor, req.currentUser?._id);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function createReply(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const reply = await CommentService.createReply(
      req.params.id,
      req.currentUser!._id,
      req.body,
    );
    res.status(201).json({ success: true, data: reply, message: 'Reply added' });
  } catch (err) {
    next(err);
  }
}

export async function deleteReply(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await CommentService.deleteReply(req.params.id, req.currentUser!._id);
    res.status(200).json({ success: true, message: 'Reply deleted' });
  } catch (err) {
    next(err);
  }
}
