"use client";

import { useState } from "react";
import { useRefresh } from "@/context/RefreshContext";

/**
 * Visible, honest disclosure that the data on screen is synthetic — shown
 * whenever the active provider is "mock". Addresses, prices, and history are
 * all generated (see src/lib/providers/mockProvider.ts); nothing here is a
 * real property, and external listing links will not resolve to anything
 * meaningful until a live provider (RentCast, a RapidAPI reseller, or a
 * Redfin CSV import) is wired in via LISTING_PROVIDER.
 */
export function DemoDataBanner() {
  const { provider } = useRefresh();
  const [dismissed, setDismissed] = useState(false);

  if (provider !== "mock" || dismissed) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
        <span>
          <strong>Demo data:</strong> every listing here is synthetically generated for testing — addresses, prices,
          and history are not real. &ldquo;View listing&rdquo; links won&apos;t resolve to real properties until a
          live data source is connected.
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-amber-700 hover:text-amber-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
