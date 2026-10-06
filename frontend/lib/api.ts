export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// The API's origin, for files it serves at /api/files/... (same origin in production behind Caddy).
const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

const TOKEN_KEY = 'truoffers_token';
// While an admin views a business ("view as business"), their own session waits here.
const ADMIN_TOKEN_KEY = 'truoffers_admin_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function startImpersonation(token: string) {
  const current = getToken();
  if (current && !localStorage.getItem(ADMIN_TOKEN_KEY)) localStorage.setItem(ADMIN_TOKEN_KEY, current);
  setToken(token);
}

/** Back to the admin's own session; false if there was none. */
export function endImpersonation(): boolean {
  const admin = localStorage.getItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  setToken(admin);
  return !!admin;
}

export class ApiError extends Error {
  status: number;
  // The response body, for errors that carry more than a message (codes, ids, duplicates)
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
  get code(): string | undefined {
    return typeof this.data.code === 'string' ? this.data.code : undefined;
  }
}

/** A message for the person, from any error. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  // FormData bodies (file uploads) need the browser to set the multipart boundary itself.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    // Expired/invalid session: drop the stale token so the UI returns to logged-out state
    if (res.status === 401 && token) setToken(null);
    let message = `Request failed (${res.status})`;
    let data: Record<string, unknown> = {};
    try {
      data = await res.json();
      // Nest puts a structured error's fields under `message` when it was thrown with an object.
      const nested = data.message && typeof data.message === 'object' && !Array.isArray(data.message) ? (data.message as Record<string, unknown>) : null;
      if (nested) data = { ...data, ...nested };
      const raw = nested ? nested.message : data.message;
      message = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : message;
    } catch {
      /* keep default */
    }
    throw new ApiError(message, res.status, data);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Uploads one file field (plus optional text fields) as multipart form data. */
export function upload<T = unknown>(path: string, file: File, fields: Record<string, string> = {}, field = 'file') {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append(field, file);
  return api<T>(path, { method: 'POST', body: form });
}

/** Downloads an authenticated file (CSV exports, private documents) and saves or opens it. */
export async function download(path: string, filename: string, open = false) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (open) {
    window.open(url, '_blank', 'noopener');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Uploaded files come back as /api/files/...; in development the API is on another origin. */
export function assetUrl(path: string | undefined | null): string | undefined {
  if (!path) return undefined;
  return path.startsWith('/api/') ? `${API_ORIGIN}${path}` : path;
}
