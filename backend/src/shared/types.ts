import { Request } from 'express';

// User attached by auth middleware
export interface AuthUser {
  id: string;
  email: string;
}

// Workspace context attached by workspace middleware
export interface WorkspaceContext {
  id: string;
  name: string;
  slug: string;
  status: string;
}

// Membership info attached by workspace middleware
export interface MembershipContext {
  id: string;
  userId: string;
  workspaceId: string;
  status: string;
  permissions: string[];
}

// Extended Express Request
export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  accessToken: string;
}

// Effective subscription state resolved by workspace middleware (Phase 3)
export type SubscriptionState =
  | 'trialing'
  | 'active'
  | 'past_due_grace'
  | 'past_due_expired'
  | 'cancelled'
  | 'suspended';

export interface WorkspaceRequest extends AuthenticatedRequest {
  workspace: WorkspaceContext;
  membership: MembershipContext;
  subscriptionState?: SubscriptionState;
}

// Standard API response
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
}

// Pagination params
export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Workspace member
export interface WorkspaceMember {
  id: string;
  user_id: string;
  workspace_id: string;
  status: string;
  joined_at: string;
  user?: {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
  };
  roles?: Array<{
    id: string;
    name: string;
  }>;
}

// Invitation
export interface Invitation {
  id: string;
  email: string;
  workspace_id: string;
  invited_by: string;
  role_id: string | null;
  custom_permissions: string[] | null;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
}

// Role
export interface Role {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  permissions?: string[];
}

// Permission
export interface Permission {
  id: string;
  code: string;
  group_name: string;
  description: string;
}
