import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { COOKIE_NAME } from '../lib/cookies';
import { User } from '../models/user.model';
import { ApiError } from '../lib/errors';

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token: string | undefined = req.cookies?.[COOKIE_NAME];
    if (!token) throw new ApiError(401, 'Please log in to continue');

    const { userId } = verifyToken(token);

    const user = await User.findById(userId).select('_id firstName lastName email avatar').lean();
    if (!user) throw new ApiError(401, 'Please log in to continue');

    req.currentUser = {
      _id: (user._id as { toString(): string }).toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatar: user.avatar,
    };

    next();
  } catch (err) {
    if (err instanceof ApiError) {
      next(err);
    } else {
      next(new ApiError(401, 'Please log in to continue'));
    }
  }
}
