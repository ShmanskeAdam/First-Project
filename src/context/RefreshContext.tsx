"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchSyncStatus, triggerSync, SyncThrottledError } from "@/lib/apiClient";

interface RefreshContextValue {
  lastSyncedAt: string | null;
  provider: string | null;
  refreshing: boolean;
  error: string | null;
  /** Bumped on every successful refresh — pages depend on this in their data-fetch effects to refetch without a full page reload. */
  refreshKey: number;
  refresh: () => Promise<void>;
}

const RefreshContext = createContext<RefreshContextValue | null>(null);

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchSyncStatus()
      .then((s) => {
        setLastSyncedAt(s.lastSyncedAt);
        setProvider(s.provider);
      })
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const status = await triggerSync();
      setLastSyncedAt(status.lastSyncedAt);
      setProvider(status.provider);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof SyncThrottledError ? err.message : "Refresh failed. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <RefreshContext.Provider value={{ lastSyncedAt, provider, refreshing, error, refreshKey, refresh }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (!ctx) throw new Error("useRefresh must be used within a RefreshProvider");
  return ctx;
}
