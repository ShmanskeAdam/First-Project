"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { useRefresh } from "@/context/RefreshContext";
import { formatRelativeTime } from "@/lib/format";

export function RefreshStatus() {
  const { lastSyncedAt, refreshing, error, refresh } = useRefresh();
  const [, forceTick] = useState(0);

  // Re-render every 15s so "3m ago" keeps advancing without a new fetch.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500" title={lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : undefined}>
        Last refreshed: <span className="font-medium text-slate-700">{formatRelativeTime(lastSyncedAt)}</span>
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
        )}
        title="Pull fresh listings from the data source now"
      >
        <span className={clsx(refreshing && "animate-spin")}>⟳</span>
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
