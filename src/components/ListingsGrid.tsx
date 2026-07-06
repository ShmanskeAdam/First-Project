"use client";

import clsx from "clsx";
import type { Listing } from "@/types/listing";
import { formatCurrency, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { getExternalListingUrl } from "@/lib/listingUrl";
import { DealBadge } from "./DealBadge";

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PENDING: "bg-amber-100 text-amber-800",
  SOLD: "bg-slate-200 text-slate-600",
};

export function ListingsGrid({ listings }: { listings: Listing[] }) {
  if (listings.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">
        No listings match the current filters.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {listings.map((l) => (
        <div key={l.id} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
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
                {l.town}, {l.county}
              </p>
            </div>
            <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[l.status])}>
              {STATUS_LABELS[l.status]}
            </span>
          </div>

          <p className="mb-1 text-xl font-bold text-slate-900">{formatCurrency(l.listPrice)}</p>
          <p className="mb-3 text-sm text-slate-500">
            {l.beds} bd · {l.baths} ba · {l.sqft.toLocaleString()} sqft · ${Math.round(l.pricePerSqft)}/sqft
          </p>

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>{PROPERTY_TYPE_LABELS[l.propertyType]}</span>
            <span>{l.yearBuilt ? `Built ${l.yearBuilt}` : "Year unknown"}</span>
            <span>{l.daysOnMarket}d on market</span>
            {l.priceChanges.length > 0 && (
              <span className="font-medium text-rose-600">
                −${Math.round(l.priceChanges[0].oldPrice - l.priceChanges[0].newPrice).toLocaleString()} cut
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <DealBadge dealScore={l.dealScoreTown} label="Town" />
            <DealBadge dealScore={l.dealScoreNj} label="NJ" />
          </div>
        </div>
      ))}
    </div>
  );
}
