"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchListingHistory, type ListingHistory } from "@/lib/apiClient";
import { formatCompactCurrency, formatCurrency, formatDate, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { getExternalListingUrl } from "@/lib/listingUrl";
import { DealBadge } from "./DealBadge";
import type { Listing } from "@/types/listing";

/**
 * Price/DOM history for one listing, built from its sync snapshots — opened
 * from the "History" button on any listing row. Fetches on open only.
 */
export function ListingHistoryModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const [history, setHistory] = useState<ListingHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchListingHistory(listing.id)
      .then(setHistory)
      .catch(() => setError("Failed to load history."));
  }, [listing.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chartData =
    history?.snapshots.map((s) => ({
      date: s.capturedAt.slice(0, 10),
      price: s.listPrice,
      dom: s.daysOnMarket,
    })) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <a
              href={getExternalListingUrl(listing)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-slate-900 hover:text-brand-700 hover:underline"
            >
              {listing.address} ↗
            </a>
            <p className="text-sm text-slate-500">
              {listing.town}, {listing.county} · {PROPERTY_TYPE_LABELS[listing.propertyType]} · {listing.beds} bd /{" "}
              {listing.baths} ba · {listing.sqft.toLocaleString()} sqft
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>

        <p className="mb-4 text-xl font-bold text-slate-900">
          {formatCurrency(listing.listPrice)}{" "}
          <span className="text-sm font-normal text-slate-500">
            ${Math.round(listing.pricePerSqft)}/sqft · {listing.daysOnMarket}d on market
          </span>
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <DealBadge dealScore={listing.dealScoreTown} label="Town" />
          <DealBadge dealScore={listing.dealScoreNj} label="NJ" />
        </div>

        {error && <p className="py-8 text-center text-sm text-rose-600">{error}</p>}
        {!history && !error && <p className="py-8 text-center text-sm text-slate-400">Loading history…</p>}

        {history && (
          <>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">List price over time</h3>
            {chartData.length < 2 ? (
              <p className="mb-4 rounded bg-slate-50 py-6 text-center text-sm text-slate-400">
                Only one observation so far — history builds up as daily syncs run.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={58}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => formatCompactCurrency(v)}
                  />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Line type="stepAfter" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}

            <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-800">Price changes</h3>
            {history.priceChanges.length === 0 ? (
              <p className="text-sm text-slate-400">No price changes observed.</p>
            ) : (
              <ul className="space-y-1">
                {history.priceChanges.map((c, i) => {
                  const drop = c.newPrice < c.oldPrice;
                  return (
                    <li key={i} className="flex items-center justify-between rounded bg-slate-50 px-3 py-1.5 text-sm">
                      <span className={drop ? "font-medium text-rose-600" : "font-medium text-emerald-600"}>
                        {drop ? "−" : "+"}
                        {formatCurrency(Math.abs(c.newPrice - c.oldPrice))} (
                        {Math.abs(Math.round(((c.newPrice - c.oldPrice) / c.oldPrice) * 100))}%)
                      </span>
                      <span className="text-slate-500">
                        {formatCurrency(c.oldPrice)} → {formatCurrency(c.newPrice)} · {formatDate(c.changedAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {(listing.dealScoreTown?.reasons.length || 0) > 0 && (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-800">Why this deal score (town comps)</h3>
                <ul className="space-y-1">
                  {listing.dealScoreTown!.reasons.map((r, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      <span className={r.points >= 0 ? "font-medium text-emerald-700" : "font-medium text-rose-700"}>
                        {r.label}:
                      </span>{" "}
                      {r.detail}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
