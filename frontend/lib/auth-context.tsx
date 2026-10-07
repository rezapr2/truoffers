'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, endImpersonation, getToken, setToken, startImpersonation } from './api';
import type { User } from './types';

type Session = { accessToken: string; user: User };

/** A password (or Google/Apple) login: a session, or the second step staff must take first. */
export type LoginStep =
  | { kind: 'session'; user: User }
  | { kind: 'two_factor'; challengeToken: string }
  | { kind: 'two_factor_setup'; challengeToken: string };

interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role?: string;
  phone?: string;
  postcode?: string;
  marketingEmails?: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginStep>;
  /** Finishes any login step that returned a session (2FA, password reset, social sign-in). */
  acceptSession: (session: unknown) => LoginStep;
  register: (data: RegisterInput) => Promise<{ user: User; devVerifyUrl?: string }>;
  logout: () => void;
  refresh: () => Promise<void>;
  impersonate: (token: string) => Promise<void>;
  stopImpersonating: () => Promise<void>;
}

const notReady = async () => {
  throw new Error('not ready');
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: notReady,
  acceptSession: () => {
    throw new Error('not ready');
  },
  register: notReady,
  logout: () => {},
  refresh: async () => {},
  impersonate: async () => {},
  stopImpersonating: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Two passes at most: an expired "view as" session falls back to the admin's own and is tried again.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!getToken()) break;
      try {
        setUser(await api<User>('/auth/me'));
        setLoading(false);
        return;
      } catch (err) {
        // Only a rejected token ends the session; a rate limit or network blip shouldn't log anyone out.
        if (!(err instanceof ApiError && err.status === 401)) break;
        if (endImpersonation()) continue;
        setToken(null);
        break;
      }
    }
    setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- session bootstrap: the token lives in localStorage, which is only readable after mount
    void refresh();
  }, [refresh]);

  const acceptSession = useCallback((result: unknown): LoginStep => {
    const r = result as Partial<Session> & { twoFactorRequired?: boolean; twoFactorSetupRequired?: boolean; challengeToken?: string };
    if (r.twoFactorRequired && r.challengeToken) return { kind: 'two_factor', challengeToken: r.challengeToken };
    if (r.twoFactorSetupRequired && r.challengeToken) return { kind: 'two_factor_setup', challengeToken: r.challengeToken };
    if (!r.accessToken || !r.user) throw new Error('Unexpected sign-in response');
    setToken(r.accessToken);
    setUser(r.user);
    return { kind: 'session', user: r.user };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      return acceptSession(res);
    },
    [acceptSession],
  );

  const register = useCallback(async (data: RegisterInput) => {
    const res = await api<Session & { devVerifyUrl?: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) });
    setToken(res.accessToken);
    setUser(res.user);
    return { user: res.user, devVerifyUrl: res.devVerifyUrl };
  }, []);

  const logout = useCallback(() => {
    endImpersonation();
    setToken(null);
    setUser(null);
  }, []);

  const impersonate = useCallback(
    async (token: string) => {
      startImpersonation(token);
      await refresh();
    },
    [refresh],
  );

  const stopImpersonating = useCallback(async () => {
    endImpersonation();
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, login, acceptSession, register, logout, refresh, impersonate, stopImpersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export const STAFF_ROLES = ['super_admin', 'admin', 'moderator', 'support_admin', 'sales_admin'];

export const isStaff = (user: Pick<User, 'role'> | null | undefined) => !!user && STAFF_ROLES.includes(user.role);

/** Mirrors the API's capability names (see backend common/permissions.ts). */
export const can = (user: Pick<User, 'capabilities'> | null | undefined, capability: string) =>
  !!user?.capabilities?.includes(capability);

/** The signed-in person's own area: the admin panel, the business dashboard, or their account page. */
export function accountHref(user: Pick<User, 'role'> | null | undefined): string {
  if (!user) return '/login';
  if (isStaff(user)) return '/admin';
  if (['business_owner', 'business_staff', 'supplier'].includes(user.role)) return '/dashboard';
  return '/account';
}

/** Where someone lands after signing in. */
export function homeFor(user: Pick<User, 'role'>): string {
  if (isStaff(user)) return '/admin';
  if (['business_owner', 'business_staff', 'supplier'].includes(user.role)) return '/dashboard';
  return '/';
}
