import { Request, Response, NextFunction } from 'express';
import * as LikeService from '../services/like.service';
import type { LikeTargetType } from '../models/like.model';

export function toggleLike(targetType: LikeTargetType) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await LikeService.toggleLike(req.params.id, targetType, req.currentUser!._id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  };
}

export function getLikes(targetType: LikeTargetType) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const users = await LikeService.getLikes(req.params.id, targetType);
      res.status(200).json({ success: true, data: users });
    } catch (err) {
      next(err);
    }
  };
}
