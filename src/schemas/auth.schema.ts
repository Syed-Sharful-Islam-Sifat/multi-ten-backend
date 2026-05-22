import { z } from 'zod';

const nameField = (label: string) =>
  z
    .string()
    .min(2, 'At least 2 characters required')
    .max(50, 'Max 50 characters')
    .regex(
      /^[A-Za-z\s'\-]+$/,
      `${label} can only contain letters, spaces, hyphens, and apostrophes`,
    )
    .trim();

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z
  .object({
    firstName: nameField('First name'),
    lastName: nameField('Last name'),
    email: z.string().email('Enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(64, 'Max 64 characters')
      .regex(/^[A-Za-z0-9]+$/, 'Only letters (A-Z, a-z) and numbers allowed'),
    repeatPassword: z.string(),
    agreed: z.boolean().refine((val) => val, { message: 'You must agree to the terms & conditions' }),
  })
  .refine((data) => data.password === data.repeatPassword, {
    message: 'Passwords do not match',
    path: ['repeatPassword'],
  });

export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
