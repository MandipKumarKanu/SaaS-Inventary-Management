import { supabaseAdmin } from '../config/supabase.js';

/**
 * Phase 5: collision-proof document numbering (PRD §46).
 *
 * Backed by the atomic SQL function next_document_number() (migration 014):
 * an upsert-increment inside one statement, safe under concurrent creation
 * (replaces `PO-${Date.now().slice(-6)}` which collides on same-ms creates).
 * Format: PO-2026-000123.
 */

export type DocType = 'PO' | 'SO' | 'TR' | 'RMA' | 'CNT';

export class DocumentNumberService {
  static async next(workspaceId: string, docType: DocType): Promise<string> {
    const { data, error } = await supabaseAdmin.rpc('next_document_number', {
      p_workspace: workspaceId,
      p_type: docType,
      p_prefix: docType,
    });

    if (error || !data) {
      // Never block document creation on a numbering failure: fall back to a
      // timestamp number (old behavior) and log loudly for ops.
      console.error('next_document_number failed, falling back to timestamp', {
        workspaceId,
        docType,
        error: error?.message,
      });
      return `${docType}-${Date.now().toString().slice(-6)}`;
    }

    return data as string;
  }
}
