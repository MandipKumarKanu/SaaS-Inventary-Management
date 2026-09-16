import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * PATCH /auth/me — strict whitelist. Anything not listed here is rejected
 * rather than silently ignored, so clients can't mass-assign columns
 * (e.g. `status`, `is_platform_admin`) through the profile endpoint.
 */
export const updateProfileSchema = z
  .object({
    name: z.string().min(1).max(100),
    avatar_url: z.string().url().max(500).nullable(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' })
  .transform((body) => ({
    name: body.name,
    ...(body.avatar_url !== undefined ? { avatar_url: body.avatar_url } : {}),
  }));
