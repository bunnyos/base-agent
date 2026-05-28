import { useCallback, useEffect, useState } from "react";

interface MeResponse {
  authenticated: boolean;
  userId?: string;
  walletAddress?: string;
}

export interface AuthState {
  loading: boolean;
  authenticated: boolean;
  walletAddress?: string;
  userId?: string;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const FETCH_OPTS: RequestInit = { credentials: "include" };

export function useAuth(): AuthState {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse>({ authenticated: false });

  const refresh = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me", FETCH_OPTS);
      if (meRes.ok) {
        const meData = (await meRes.json()) as MeResponse;
        setMe(meData);
      } else if (meRes.status === 401) {
        setMe({ authenticated: false });
      }
    } catch {
      // keep previous me state
    }
    setLoading(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", ...FETCH_OPTS });
    } catch {
      // ignore — cookie may still be cleared client-side via reload
    }
    // Hard reload so all react-query caches, chat panels, wallet panels,
    // and the auth hook itself re-initialize from scratch against a
    // now-unauthenticated session. A soft `refresh()` here leaves stale
    // user data on screen and makes sign-out feel like it didn't work.
    window.location.reload();
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    loading,
    authenticated: me.authenticated,
    ...(me.walletAddress !== undefined ? { walletAddress: me.walletAddress } : {}),
    ...(me.userId !== undefined ? { userId: me.userId } : {}),
    refresh,
    logout,
  };
}
