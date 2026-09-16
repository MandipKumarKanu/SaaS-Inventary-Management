import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { logger } from '../../config/logger.js';
import { AuditService } from '../audit/audit.service.js';
import { checkIsPlatformAdmin } from '../../middleware/platform-admin.middleware.js';

interface SignupParams {
  email: string;
  password: string;
  name: string;
}

interface LoginParams {
  email: string;
  password: string;
}

export class AuthService {
  /**
   * Register a new user
   * Creates Supabase Auth user + profile in users table
   */
  static async signup(params: SignupParams) {
    const { email, password, name } = params;

    // 1. Create Supabase auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    if (authError || !authData.user) {
      logger.error('Signup auth error', { error: authError?.message });
      if (authError?.message?.includes('already registered')) {
        throw AppError.conflict('An account with this email already exists', 'EMAIL_EXISTS');
      }
      throw AppError.badRequest(authError?.message || 'Failed to create user');
    }

    // 2. Create profile in users table
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        email: email.toLowerCase(),
        name,
        status: 'active',
      })
      .select('id, email, name, avatar_url, status, created_at')
      .single();

    if (profileError) {
      logger.error('Failed to create user profile', { error: profileError.message });
      throw AppError.internal('Failed to complete user registration');
    }

    const isPlatformAdmin = await checkIsPlatformAdmin(authData.user.id, email);

    return {
      user: { ...userProfile, is_platform_admin: isPlatformAdmin },
      session: {
        access_token: authData.session?.access_token,
        refresh_token: authData.session?.refresh_token,
        expires_at: authData.session?.expires_at,
      },
    };
  }

  /**
   * Login user with email & password
   */
  static async login(params: LoginParams, ipAddress?: string) {
    const { email, password } = params;

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, email, name, avatar_url, status')
      .eq('id', data.user.id)
      .single();

    if (profile?.status === 'suspended') {
      throw AppError.forbidden('Your account has been suspended', 'ACCOUNT_SUSPENDED');
    }

    // Audit
    await AuditService.log({
      userId: data.user.id,
      action: 'user.login',
      entity: 'user',
      entityId: data.user.id,
      ipAddress,
    });

    const isPlatformAdmin = await checkIsPlatformAdmin(data.user.id, profile?.email || email);

    return {
      user: { ...(profile || { id: data.user.id, email }), is_platform_admin: isPlatformAdmin },
      session: {
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_at: data.session?.expires_at,
      },
    };
  }

  /**
   * Refresh session token
   */
  static async refreshToken(refreshToken: string) {
    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      throw AppError.unauthorized('Invalid or expired refresh token');
    }

    return {
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_at: data.session?.expires_at,
    };
  }

  /**
   * Request password reset
   */
  static async forgotPassword(email: string) {
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`,
    });

    if (error) {
      logger.error('Password reset request failed', { error: error.message });
      // Don't reveal if email exists
    }

    // Always return success to prevent email enumeration
    return { message: 'If an account exists with this email, a reset link has been sent.' };
  }

  /**
   * Get current user profile
   */
  static async getProfile(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, name, avatar_url, status, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw AppError.notFound('User not found');
    }

    const isPlatformAdmin = await checkIsPlatformAdmin(userId, data.email);

    return {
      ...data,
      is_platform_admin: isPlatformAdmin,
    };
  }

  /**
   * Update user profile
   */
  static async updateProfile(userId: string, updates: { name?: string; avatar_url?: string | null }) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select('id, email, name, avatar_url, status')
      .single();

    if (error) {
      throw AppError.internal('Failed to update profile');
    }

    return data;
  }
}
