import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ApiError } from '../lib/errors';
import { logger } from '../lib/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    logger.warn({ code: err.code, field: err.field, message: err.message }, 'Multer error');
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'File too large. Max 5MB per image.' :
      err.code === 'LIMIT_FILE_COUNT' ? 'Too many files. Max 4 images per post.' :
      err.code === 'LIMIT_UNEXPECTED_FILE' ? `Unexpected field "${err.field}". Use field name "images".` :
      err.message;
    res.locals.errorMessage = message;
    res.status(400).json({ success: false, message, field: 'images' });
    return;
  }

  if (err instanceof ApiError) {
    res.locals.errorMessage = err.message; // res.locals.errorMessage 
    // the locals object is used to isolate error messages from other requests. 
    // As a global error message could face race conditions. 
    // res.locals is created when request arrives and destroyed when response is sent, 
    // and scoped to that request only
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.field !== undefined && { field: err.field }),
    });
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.locals.errorMessage = 'Something went wrong. Please try again.';
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again.',
  });
}
