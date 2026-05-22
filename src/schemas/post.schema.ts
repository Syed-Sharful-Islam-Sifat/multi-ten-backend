import { z } from 'zod';

export const createPostSchema = z.object({
  content: z
    .string()
    .min(1, 'Post content is required')
    .max(2000, 'Post cannot exceed 2000 characters')
    .trim(),
  visibility: z.enum(['public', 'private']).default('public'),
});

export const updatePostSchema = z.object({
  content: z
    .string()
    .min(1, 'Post content is required')
    .max(2000, 'Post cannot exceed 2000 characters')
    .trim(),
  visibility: z.enum(['public', 'private']).optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
