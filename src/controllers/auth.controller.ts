import { Request, Response, NextFunction } from 'express';
import * as AuthService from '../services/auth.service';
import { setAuthCookie, clearAuthCookie } from '../lib/cookies';

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, user } = await AuthService.register(req.body);
    setAuthCookie(res, token);
    res.status(201).json({ success: true, data: user, message: 'Account created successfully' });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, user } = await AuthService.login(req.body);
    setAuthCookie(res, token);
    res.status(200).json({ success: true, data: user, message: 'Logged in successfully' });
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response): Promise<void> {
  clearAuthCookie(res);
  res.status(200).json({ success: true, message: 'Logged out successfully' });
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await AuthService.getMe(req.currentUser!._id);
    res.status(200).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}
