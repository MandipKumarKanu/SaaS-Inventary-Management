import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitizes input into a clean URL-safe slug:
 * - Converts to lowercase
 * - Replaces spaces and underscores with hyphens
 * - Removes any character that is not alphanumeric or a hyphen
 * - Collapses consecutive hyphens into a single hyphen
 */
export function sanitizeSlug(input) {
  if (!input) return '';
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Formats dynamic input while typing, calling onConverted if spaces/special chars were replaced.
 */
export function formatSlugInput(value, onConverted) {
  if (!value) return '';
  const hasSpacesOrSpecial = /[\s_A-Z]|[^a-z0-9-]/g.test(value);
  const formatted = value
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-');

  if (hasSpacesOrSpecial && onConverted) {
    onConverted();
  }
  return formatted;
}

