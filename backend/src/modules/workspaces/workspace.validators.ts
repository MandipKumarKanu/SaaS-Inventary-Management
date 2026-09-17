import { z } from 'zod';

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').max(100),
  slug: z.string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens (e.g. acme-corp)')
    .optional(),
  currency: z.string().max(10).optional().default('NPR'),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logo_url: z.string().url().optional().nullable(),
  settings: z.record(z.any()).optional(),
});
