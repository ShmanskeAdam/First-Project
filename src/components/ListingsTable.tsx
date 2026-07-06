"use client";

import clsx from "clsx";
import type { Listing, SortField } from "@/types/listing";
import { formatCurrency, formatNumber, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { getExternalListingUrl } from "@/lib/listingUrl";
import { DealBadge } from "./DealBadge";

interface ListingsTableProps {
  listings: Listing[];
  sortField?: SortField;
  sortDir: "asc" | "desc";
  onSort: (field: SortField) => void;
}

interface Column {
  field?: SortField;
  label: string;
  render: (l: Listing) => React.ReactNode;
  className?: string;
}

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PENDING: "bg-amber-100 text-amber-800",
  SOLD: "bg-slate-200 text-slate-600",
};

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={clsx(
        "flex items-center gap-1 whitespace-nowrap text-xs font-semibold uppercase tracking-wide",
        active ? "text-brand-700" : "text-slate-500",
        onClick && "hover:text-brand-700"
      )}
    >
      {label}
      {active && <span>{dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

export function ListingsTable({ listings, sortField, sortDir, onSort }: ListingsTableProps) {
  const columns: Column[] = [
    {
      label: "Address",
      render: (l) => (
        <div>
          <a
            href={getExternalListingUrl(l)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
            title="View listing"
          >
            {l.address} ↗
          </a>
          <p className="text-xs text-slate-500">
            {l.town}, {l.county} · {l.zip}
          </p>
        </div>
      ),
    },
    { field: "listPrice", label: "Price", render: (l) => formatCurrency(l.listPrice) },
    { field: "pricePerSqft", label: "$/sqft", render: (l) => `$${Math.round(l.pricePerSqft)}` },
    { field: "beds", label: "Beds", render: (l) => l.beds },
    { field: "baths", label: "Baths", render: (l) => l.baths },
    { field: "sqft", label: "Sqft", render: (l) => formatNumber(l.sqft) },
    { field: "lotSizeSqft", label: "Lot", render: (l) => (l.lotSizeSqft ? formatNumber(l.lotSizeSqft) : "—") },
    { field: "yearBuilt", label: "Built", render: (l) => l.yearBuilt ?? "—" },
    { label: "Type", render: (l) => PROPERTY_TYPE_LABELS[l.propertyType] },
    { field: "daysOnMarket", label: "DOM", render: (l) => `${l.daysOnMarket}d` },
    {
      label: "Price history",
      render: (l) =>
        l.priceChanges.length === 0 ? (
          <span className="text-slate-400">No cuts</span>
        ) : (
          <span className="text-rose-600">
            −${Math.round(l.priceChanges[0].oldPrice - l.priceChanges[0].newPrice).toLocaleString()} (
            {l.priceChanges.length})
          </span>
        ),
    },
    {
      label: "Status",
      render: (l) => (
        <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[l.status])}>
          {STATUS_LABELS[l.status]}
        </span>
      ),
    },
    {
      field: "dealScoreTown",
      label: "Deal score (Town)",
      render: (l) => <DealBadge dealScore={l.dealScoreTown} />,
    },
    {
      field: "dealScoreNj",
      label: "Deal score (NJ)",
      render: (l) => <DealBadge dealScore={l.dealScoreNj} />,
    },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[1300px] border-collapse text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.label} className="px-3 py-2.5 text-left">
                <SortHeader
                  label={c.label}
                  active={sortField === c.field}
                  dir={sortDir}
                  onClick={c.field ? () => onSort(c.field as SortField) : undefined}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => (
            <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.label} className="px-3 py-2.5 align-top">
                  {c.render(l)}
                </td>
              ))}
            </tr>
          ))}
          {listings.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">
                No listings match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
