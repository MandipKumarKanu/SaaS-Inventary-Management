import { AuthUser, WorkspaceContext, MembershipContext } from '../shared/types.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      accessToken?: string;
      workspace?: WorkspaceContext;
      membership?: MembershipContext;
    }
  }
}
