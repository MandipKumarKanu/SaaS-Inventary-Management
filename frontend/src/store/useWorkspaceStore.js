import { create } from 'zustand';
import { api } from '../lib/api';

export const useWorkspaceStore = create((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  membership: null,
  permissions: [],
  isLoading: false,
  error: null,

  fetchWorkspaces: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get('/workspaces');
      const list = res.data || [];
      set({ workspaces: list, isLoading: false });

      // Automatically select workspace if none selected or invalid
      const storedId = localStorage.getItem('active_workspace_id');
      const found = list.find((w) => w.id === storedId) || list[0];

      if (found && (!get().activeWorkspace || get().activeWorkspace.id !== found.id)) {
        get().setActiveWorkspace(found);
      }
      return list;
    } catch (err) {
      set({ error: err.message, isLoading: false });
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
      const member = res.data;
      set({
        membership: member,
        permissions: member.permissions || [],
      });
    } catch {
      set({ membership: null, permissions: [] });
    }
  },

  createWorkspace: async (name, slug) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/workspaces', { name, slug });
      const newWs = res.data;
      set((state) => ({
        workspaces: [newWs, ...state.workspaces],
        isLoading: false,
      }));
      get().setActiveWorkspace(newWs);
      return newWs;
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  hasPermission: (permissionCode) => {
    const { permissions } = get();
    return permissions.includes(permissionCode) || permissions.includes('*');
  },
}));
