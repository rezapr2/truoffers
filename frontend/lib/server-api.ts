// Server-side fetch helper for public (unauthenticated) API data.
// In containers the API is reached directly over the internal network via
// INTERNAL_API_URL, so server renders don't round-trip through the proxy.
const API_URL =
  process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export async function serverApi<T = unknown>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
