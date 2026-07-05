"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDeals, fetchTowns } from "@/lib/apiClient";
import { formatCurrency, PROPERTY_TYPE_LABELS } from "@/lib/format";
import { DealBadge } from "@/components/DealBadge";
import { TownMultiSelect } from "@/components/TownMultiSelect";
import { useRefresh } from "@/context/RefreshContext";
import type { Listing, PropertyType } from "@/types/listing";
import type { TownInfo } from "@/lib/towns";

const PROPERTY_TYPES: { value: PropertyType | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "SINGLE_FAMILY", label: "Single-Family" },
  { value: "MULTI_FAMILY", label: "Multi-Family" },
  { value: "CONDO", label: "Condo" },
  { value: "TOWNHOUSE", label: "Townhouse" },
];

export default function DealsPage() {
  const [towns, setTowns] = useState<TownInfo[]>([]);
  const [selectedTowns, setSelectedTowns] = useState<string[]>([]);
  const [propertyType, setPropertyType] = useState<PropertyType | "">("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refreshKey } = useRefresh();

  useEffect(() => {
    fetchTowns()
      .then((r) => setTowns(r.towns))
      .catch(() => undefined);
  }, [refreshKey]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchDeals(
      {
        towns: selectedTowns.length ? selectedTowns : undefined,
        propertyTypes: propertyType ? [propertyType] : undefined,
      },
      50
    )
      .then((r) => setListings(r.listings))
      .catch(() => setError("Failed to load top deals."))
      .finally(() => setLoading(false));
  }, [selectedTowns, propertyType, refreshKey]);

  return (
    <div>
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

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property type</span>
          <select
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value as PropertyType | "")}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {PROPERTY_TYPES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Towns (optional)</p>
        <TownMultiSelect towns={towns} selected={selectedTowns} onChange={setSelectedTowns} />
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

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
          {listings.map((l, i) => (
            <li key={l.id} className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-4">
              <span className="w-8 shrink-0 text-center text-lg font-bold text-slate-300">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{l.address}</p>
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
                  <DealBadge dealScore={l.dealScore} />
                  {l.dealScore?.reasons.slice(0, 2).map((r, idx) => (
                    <span key={idx} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      {r.detail}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
