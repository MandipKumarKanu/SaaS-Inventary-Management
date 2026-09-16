export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  /** Optional structured payload surfaced to clients (e.g. { metric, limit }). */
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, code: string = 'BAD_REQUEST') {
    return new AppError(message, 400, code);
  }

  static unauthorized(message: string = 'Authentication required', code: string = 'UNAUTHORIZED') {
    return new AppError(message, 401, code);
  }

  static forbidden(message: string = 'Access denied', code: string = 'FORBIDDEN') {
    return new AppError(message, 403, code);
  }

  static notFound(message: string = 'Resource not found', code: string = 'NOT_FOUND') {
    return new AppError(message, 404, code);
  }

  static conflict(message: string, code: string = 'CONFLICT') {
    return new AppError(message, 409, code);
  }

  /**
   * 422 Unprocessable Entity — the request is well-formed JSON, but its
   * contents fail a business rule / validation that isn't structural.
   */
  static unprocessable(message: string, code: string = 'UNPROCESSABLE') {
    return new AppError(message, 422, code);
  }

  static tooMany(message: string = 'Too many requests', code: string = 'RATE_LIMIT') {
    return new AppError(message, 429, code);
  }

  static internal(message: string = 'Internal server error', code: string = 'INTERNAL_ERROR') {
    return new AppError(message, 500, code, false);
  }

  static limitReached(resource: string, limit: number) {
    return new AppError(
      `${resource} limit reached (${limit}). Please upgrade your plan.`,
      403,
      'LIMIT_REACHED'
    );
  }

  /**
   * Phase 3: plan usage limit exceeded. Carries structured details so the UI
   * can render targeted upgrade prompts.
   */
  static planLimitReached(metric: string, limit: number, planTier: string) {
    return new AppError(
      `Your ${planTier} plan allows ${limit} ${metric}. Upgrade your plan to add more.`,
      403,
      'PLAN_LIMIT_REACHED',
      true,
      { metric, limit, planTier }
    );
  }

  /**
   * Phase 3: the workspace's plan does not include this feature (PRD §16).
   */
  static planFeatureDisabled(feature: string, planTier: string) {
    return new AppError(
      `The ${feature} feature is not included in your ${planTier} plan. Upgrade to enable it.`,
      403,
      'PLAN_FEATURE_DISABLED',
      true,
      { feature, planTier }
    );
  }

  /**
   * Phase 4: illegal workflow status transition (PRD §76, Rule #17).
   */
  static invalidTransition(entity: string, from: string, to: string, reason?: string) {
    return new AppError(
      reason || `Invalid status transition for ${entity.replace(/_/g, ' ')}: ${from} → ${to}`,
      422,
      'INVALID_STATUS_TRANSITION',
      true,
      { entity, from, to }
    );
  }
}
