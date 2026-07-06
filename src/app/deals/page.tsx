"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  fetchDeals,
  fetchTowns,
  fetchPresets,
  createPreset,
  deletePreset as deletePresetApi,
} from "@/lib/apiClient";
import { formatCurrency, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { getExternalListingUrl } from "@/lib/listingUrl";
import { DealBadge } from "@/components/DealBadge";
import { FilterPanel } from "@/components/FilterPanel";
import { useRefresh } from "@/context/RefreshContext";
import type { Listing, ListingFilters, FilterPreset } from "@/types/listing";
import type { TownInfo } from "@/lib/towns";

const LIMIT = 50;

export default function DealsPage() {
  const [towns, setTowns] = useState<TownInfo[]>([]);
  const [filters, setFilters] = useState<ListingFilters>({});
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [rankBy, setRankBy] = useState<"town" | "nj">("town");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refreshKey } = useRefresh();

  useEffect(() => {
    fetchTowns()
      .then((r) => setTowns(r.towns))
      .catch(() => undefined);
    fetchPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => undefined);
  }, [refreshKey]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchDeals(filters, LIMIT, rankBy)
      .then((r) => setListings(r.listings))
      .catch(() => setError("Failed to load top deals."))
      .finally(() => setLoading(false));
    // refreshKey isn't read in the body — bumped by the nav-bar "Refresh" button so this
    // callback identity changes and the effect below refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, rankBy, refreshKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSavePreset(name: string) {
    const { preset } = await createPreset(name, filters);
    setPresets((p) => [preset, ...p]);
  }

  function handleApplyPreset(preset: FilterPreset) {
    setFilters(preset.filters);
  }

  async function handleDeletePreset(id: string) {
    await deletePresetApi(id);
    setPresets((p) => p.filter((x) => x.id !== id));
  }

  return (
    <div className="flex gap-6">
      <FilterPanel
        towns={towns}
        filters={filters}
        onChange={setFilters}
        presets={presets}
        onSavePreset={handleSavePreset}
        onApplyPreset={handleApplyPreset}
        onDeletePreset={handleDeletePreset}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Top Deals</h1>
          <p className="text-sm text-slate-500">
            Active listings ranked by deal score — underpriced relative to comps, recent price cuts, and comparable
            sold prices.{" "}
            <Link href="/settings" className="text-brand-600 hover:underline">
              Tune scoring weights
            </Link>
          </p>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rank by</span>
          {(["town", "nj"] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setRankBy(scope)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                rankBy === scope ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"
              }`}
            >
              {scope === "town" ? "Town comps" : "All North NJ"}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">
            Scoring listings…
          </div>
        ) : listings.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">
            No active listings match this selection.
          </div>
        ) : (
          <ol className="space-y-3">
            {listings.map((l, i) => {
              const primaryScore = rankBy === "town" ? l.dealScoreTown : l.dealScoreNj;
              return (
                <li key={l.id} className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4">
                  <span className="w-8 shrink-0 text-center text-lg font-bold text-slate-300">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <a
                          href={getExternalListingUrl(l)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-slate-900 hover:text-brand-700 hover:underline"
                          title="View listing"
                        >
                          {l.address} ↗
                        </a>
                        <p className="text-xs text-slate-500">
                          {l.town}, {l.county} · {PROPERTY_TYPE_LABELS[l.propertyType]} · {l.beds} bd / {l.baths} ba ·{" "}
                          {l.sqft.toLocaleString()} sqft
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900">{formatCurrency(l.listPrice)}</p>
                        <p className="text-xs text-slate-500">${Math.round(l.pricePerSqft)}/sqft</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <DealBadge dealScore={l.dealScoreTown} label="Town" />
                      <DealBadge dealScore={l.dealScoreNj} label="NJ" />
                      {primaryScore?.reasons.slice(0, 2).map((r, idx) => (
                        <span key={idx} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                          {r.detail}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
