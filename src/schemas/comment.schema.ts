import { z } from 'zod';

export const createCommentSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment cannot be empty')
    .max(500, 'Comment cannot exceed 500 characters')
    .trim(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
