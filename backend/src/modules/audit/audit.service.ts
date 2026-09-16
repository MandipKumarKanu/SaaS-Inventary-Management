import { supabaseAdmin } from '../../config/supabase.js';
import { logger } from '../../config/logger.js';
import type { TxClient } from '../../db/pool.js';
import { getAuditContext } from '../../middleware/audit-context.middleware.js';

interface AuditLogParams {
  workspaceId?: string | null;
  userId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  previousValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Audit logging service
 * Creates immutable audit log entries
 * Never throws — logging failures should not break business operations
 */
export class AuditService {
  static async log(params: AuditLogParams): Promise<void> {
    try {
      // Phase 4: enrich with request context (IP + user-agent) when the caller
      // didn't supply them explicitly (PRD §41).
      const ctx = getAuditContext();
      const { error } = await supabaseAdmin.from('audit_logs').insert({
        workspace_id: params.workspaceId || null,
        user_id: params.userId,
        action: params.action,
        entity: params.entity,
        entity_id: params.entityId || null,
        previous_value: params.previousValue || null,
        new_value: params.newValue || null,
        ip_address: params.ipAddress || ctx?.ipAddress || null,
        user_agent: params.userAgent || ctx?.userAgent || null,
      });

      if (error) {
        logger.error('Failed to create audit log', { error: error.message, params });
      }
    } catch (err: any) {
      // Never let audit logging break the main operation
      logger.error('Audit log exception', { error: err.message });
    }
  }

  /**
   * Write an audit row INSIDE the caller's database transaction (Phase 2).
   *
   * Used by the transactional stock operations (transfers, purchases, sales,
   * counts, returns) so the audit trail commits or rolls back ATOMICALLY with
   * the movements it describes — a crash after COMMIT can no longer leave a
   * stock change without its "who/why" record (PRD §41, Rule #4/#10).
   *
   * Unlike `log()` (which never throws so logging can't break business
   * operations), `logTx` PROPAGATES failures: inside a Postgres transaction a
   * failed statement aborts the transaction anyway, so swallowing the error
   * here would silently drop the audit row while everything else rolls back.
   */
  static async logTx(client: TxClient, params: AuditLogParams): Promise<void> {
    const ctx = getAuditContext();
    await client.query(
      `INSERT INTO audit_logs
         (workspace_id, user_id, action, entity, entity_id,
          previous_value, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        params.workspaceId || null,
        params.userId,
        params.action,
        params.entity,
        params.entityId || null,
        params.previousValue ? JSON.stringify(params.previousValue) : null,
        params.newValue ? JSON.stringify(params.newValue) : null,
        params.ipAddress || ctx?.ipAddress || null,
        params.userAgent || ctx?.userAgent || null,
      ]
    );
  }
}
