import axios from 'axios';

const rawApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

function normalizeApiUrl(url) {
  let cleaned = url.trim().replace(/\/+$/, '');
  if (cleaned.endsWith('/v1') && !cleaned.endsWith('/api/v1')) {
    cleaned = cleaned.replace(/\/v1$/, '/api/v1');
  } else if (!cleaned.endsWith('/api/v1')) {
    if (cleaned.endsWith('/api')) {
      cleaned = `${cleaned}/v1`;
    } else {
      cleaned = `${cleaned}/api/v1`;
    }
  }
  return cleaned;
}

const API_BASE_URL = normalizeApiUrl(rawApiUrl);

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

// Response interceptor: handle 401 unauth & extract detailed error messages
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token if unauthorized
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
    }

    const errData = error.response?.data?.error;
    let message = errData?.message || error.message || 'An unexpected error occurred';

    // Format detailed validation or field errors if present
    if (errData?.details && Array.isArray(errData.details) && errData.details.length > 0) {
      message = `${message}: ${errData.details.join(', ')}`;
    } else if (errData?.fields && typeof errData.fields === 'object') {
      const fieldErrors = Object.entries(errData.fields)
        .map(([field, errMsg]) => `${field}: ${errMsg}`)
        .filter(Boolean)
        .join(', ');
      if (fieldErrors) {
        message = `${message}: ${fieldErrors}`;
      }
    }

    const customErr = new Error(message);
    if (errData) {
      customErr.code = errData.code;
      customErr.details = errData.details;
      customErr.fields = errData.fields;
    }

    return Promise.reject(customErr);
  }
);
