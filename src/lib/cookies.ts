import { Response } from 'express';

const COOKIE_NAME = 'auth_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: '/',
};

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, path: '/' });
}

export { COOKIE_NAME };
