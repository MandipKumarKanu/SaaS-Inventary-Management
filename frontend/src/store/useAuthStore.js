import { create } from 'zustand';
import { api, getValidToken } from '../lib/api';
import { useWorkspaceStore } from './useWorkspaceStore';

const initialUser = (() => {
  try {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
})();

// Backend returns { user, session: { access_token, refresh_token, expires_at } }.
// Extract the real JWT (never persist undefined — that poisons the interceptor
// with a literal "undefined" Bearer token).
function extractSession(data) {
  const token = data?.session?.access_token || data?.token || null;
  const refreshToken = data?.session?.refresh_token || data?.refreshToken || null;
  return { user: data?.user || null, token, refreshToken };
}

function persistSession(user, token, refreshToken) {
  if (token) {
    localStorage.setItem('access_token', token);
  } else {
    localStorage.removeItem('access_token');
  }
  if (refreshToken) {
    localStorage.setItem('refresh_token', refreshToken);
  } else {
    localStorage.removeItem('refresh_token');
  }
  if (user) {
    localStorage.setItem('user', JSON.stringify(user));
  }
}

export const useAuthStore = create((set) => ({
  user: getValidToken() ? initialUser : null,
  token: getValidToken(),
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/auth/login', { email, password });
      const { user, token, refreshToken } = extractSession(res.data);

      if (!token) {
        throw new Error('Login succeeded but no session token was returned');
      }
      persistSession(user, token, refreshToken);

      set({ user, token, isLoading: false });
      return user;
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  signup: async (email, password, name) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/auth/signup', { email, password, name });
      const { user, token, refreshToken } = extractSession(res.data);

      // Signup auto-login can fail server-side (session: null) — account
      // exists but user must sign in manually. Never store a bad token.
      persistSession(user, token, refreshToken);

      set({ user, token, isLoading: false });
      return user;
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  fetchProfile: async () => {
    try {
      const res = await api.get('/auth/me');
      if (res.data?.data) {
        const updatedUser = res.data.data;
        localStorage.setItem('user', JSON.stringify(updatedUser));
        set({ user: updatedUser });
        return updatedUser;
      }
    } catch {
      // Ignore background profile fetch errors
    }
  },

  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('active_workspace_id');
    try {
      useWorkspaceStore.getState().resetStore();
    } catch {
      // Ignore if store not initialized
    }
    set({ user: null, token: null });
  },

  clearError: () => set({ error: null }),
}));
