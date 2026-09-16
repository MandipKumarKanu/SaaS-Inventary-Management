import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors.js';
import { logger } from '../config/logger.js';
import { ZodError } from 'zod';

/**
 * Global error handler middleware
 * Converts all errors to consistent JSON API responses
 * Never exposes raw database errors or stack traces in production
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Zod validation errors — field-level detail, 422 Unprocessable Entity
  // (the request was well-formed JSON, but its contents fail validation).
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    const messages: string[] = [];
    for (const issue of err.errors) {
      const field = issue.path.join('.') || '_root';
      fields[field] = issue.message;
      messages.push(`${field}: ${issue.message}`);
    }
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: messages,
        fields,
      },
    });
    return;
  }

  // Known operational errors
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error('Non-operational error', { error: err.message, stack: err.stack });
    }

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Unknown/unexpected errors
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    name: err.name,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    },
  });
}
