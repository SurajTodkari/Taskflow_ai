import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setAuthLostHandler, tokenStore } from './api';
import type { AuthResponse, User } from './types';
import { startRealtime, stopRealtime } from './ws';
import { registerSW } from './push';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { email: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.access);

  const finish = useCallback((d: AuthResponse) => {
    tokenStore.set(d.access_token, d.refresh_token);
    setUser(d.user);
  }, []);

  useEffect(() => {
    setAuthLostHandler(() => { setUser(null); qc.clear(); });
    return () => setAuthLostHandler(null);
  }, [qc]);

  useEffect(() => {
    if (!tokenStore.access && !tokenStore.refresh) { setLoading(false); return; }
    api.me().then(setUser).catch(() => { tokenStore.clear(); setUser(null); }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) { startRealtime(qc); registerSW(); } else stopRealtime();
    return () => stopRealtime();
  }, [user, qc]);

  const value = useMemo<AuthCtx>(() => ({
    user, loading,
    login: async (email, password) => finish(await api.login(email, password)),
    register: async (b) => finish(await api.register({ ...b, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })),
    logout: async () => {
      const rt = tokenStore.refresh;
      try { if (rt) await api.logout(rt); } catch { /* ignore */ }
      tokenStore.clear(); setUser(null); qc.clear();
    },
  }), [user, loading, finish, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}
