import { create } from 'zustand';
import { api } from '../lib/api';

export const useWorkspaceStore = create((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  membership: null,
  permissions: [],
  isLoading: false,
  hasFetched: false,
  error: null,

  fetchWorkspaces: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/workspaces');
      const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      set({ workspaces: list, isLoading: false, hasFetched: true });

      // Automatically select workspace if none selected or invalid
      const storedId = localStorage.getItem('active_workspace_id');
      const found = list.find((w) => w.id === storedId) || list[0];

      if (found && (!get().activeWorkspace || get().activeWorkspace.id !== found.id)) {
        get().setActiveWorkspace(found);
      }
      return list;
    } catch (err) {
      set({ error: err.message, isLoading: false, hasFetched: true, workspaces: [] });
      return [];
    }
  },

  setActiveWorkspace: (workspace) => {
    if (!workspace) return;
    localStorage.setItem('active_workspace_id', workspace.id);
    set({ activeWorkspace: workspace });
    get().fetchCurrentMember(workspace.id);
  },

  fetchCurrentMember: async (workspaceId) => {
    try {
      const res = await api.get(`/workspaces/${workspaceId}/members/me`);
      const member = res?.data || res || {};
      set({
        membership: { ...member, workspace_id: workspaceId },
        permissions: member.permissions || [],
      });
    } catch {
      set({ membership: { workspace_id: workspaceId, error: true }, permissions: [] });
    }
  },

  createWorkspace: async (name, slug, currency = 'NPR') => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/workspaces', { name, slug, currency });
      const newWs = res.data;
      set((state) => ({
        workspaces: [newWs, ...state.workspaces],
        isLoading: false,
        hasFetched: true,
      }));
      get().setActiveWorkspace(newWs);
      return newWs;
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  resetStore: () => {
    localStorage.removeItem('active_workspace_id');
    set({
      workspaces: [],
      activeWorkspace: null,
      membership: null,
      permissions: [],
      isLoading: false,
      hasFetched: false,
      error: null,
    });
  },

  hasPermission: (permissionCode) => {
    const { permissions } = get();
    return permissions.includes(permissionCode) || permissions.includes('*');
  },
}));
