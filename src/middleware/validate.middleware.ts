import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

// this middleware is used to validate the request body against a zod schema.
// its a closure concept where the inner function has access to the schema variable and
// remembers the schema when request arrives express call that middleware with req and res objects,
// its a clean approach for validation as we are reusing it
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (result.success) {
      req.body = result.data;
      return next();
    }

    const firstError = result.error.errors[0];
    const message = firstError?.message ?? 'Validation failed';
    const field = firstError?.path[0];
    res.locals.errorMessage = field ? `[${field}] ${message}` : message;
    res.status(400).json({
      success: false,
      message,
      field: field ?? undefined,
    });
  };
}
