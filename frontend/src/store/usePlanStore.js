import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../lib/api';
import { useWorkspaceStore } from './useWorkspaceStore';

/**
 * Phase 9 (PRD §16): client mirror of the plan's feature flags.
 *
 * Source of truth: billing summary (flat shape: plan_tier, features, limits,
 * usage — see BillingService.getBillingSummary). Server-enforced on every
 * request by requireFeature; this store exists purely so the UI can render
 * locks/upgrade prompts instead of letting users hit a 403.
 */
export const usePlanStore = create((set, get) => ({
  summary: null, // billing summary object (flat shape)
  isLoading: false,
  error: null,

  fetchPlan: async () => {
    const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
    if (!activeWorkspace) return null;
    set({ isLoading: true, error: null });
    try {
      const res = await api.get(`/workspaces/${activeWorkspace.id}/billing`);
      set({ summary: res.data || null, isLoading: false });
      return res.data;
    } catch (err) {
      // Billing view is permission-gated — members without billing.view get
      // no feature flags (features render ungated in the UI; the server
      // still decides).
      set({ error: err.message, isLoading: false, summary: null });
      return null;
    }
  },

  hasFeature: (featureKey) => {
    const { summary } = get();
    if (!summary?.features) return true; // unknown plan → don't gate the UI
    return Boolean(summary.features[featureKey]);
  },
}));

/** Hook: does the active workspace's plan include this feature? */
export function usePlanFeature(featureKey) {
  const summary = usePlanStore((s) => s.summary);
  const fetchPlan = usePlanStore((s) => s.fetchPlan);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  useEffect(() => {
    fetchPlan();
  }, [activeWorkspace?.id, fetchPlan]);

  if (!summary?.features) return { enabled: true, summary: null, loaded: false };
  return { enabled: Boolean(summary.features[featureKey]), summary, loaded: true };
}

/** Hook: the workspace's plan display name + tier (null when not loaded). */
export function usePlanInfo() {
  const summary = usePlanStore((s) => s.summary);
  const fetchPlan = usePlanStore((s) => s.fetchPlan);
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  useEffect(() => {
    fetchPlan();
  }, [activeWorkspace?.id, fetchPlan]);

  return {
    tier: summary?.plan_tier || null,
    displayName: summary?.plan_display_name || null,
    status: summary?.status || null,
    usage: summary?.usage || null,
    limits: summary?.limits || null,
    loaded: Boolean(summary),
  };
}
