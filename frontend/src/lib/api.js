import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Read the stored access token, treating poisoned/empty values as absent.
// (A previous auth-contract mismatch stored the literal strings
// "undefined"/"null" — those must never be sent as Bearer tokens.)
export function getValidToken() {
  const token = localStorage.getItem('access_token');
  if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
    if (token !== null) localStorage.removeItem('access_token');
    return null;
  }
  return token;
}

// Request interceptor: attach token & active workspace header
api.interceptors.request.use((config) => {
  const token = getValidToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const activeWorkspaceId = localStorage.getItem('active_workspace_id');
  if (activeWorkspaceId) {
    config.headers['X-Workspace-Id'] = activeWorkspaceId;
  }

  return config;
}, (error) => {
  return Promise.reject(error);
});

// Response interceptor: handle 401 unauth
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token if unauthorized
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
    }
    const message = error.response?.data?.error?.message || error.message || 'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);
