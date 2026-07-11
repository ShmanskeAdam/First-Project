"use client";

import { useEffect, useState, useCallback } from "react";
import { FilterPanel } from "@/components/FilterPanel";
import { ListingsTable } from "@/components/ListingsTable";
import { ListingsGrid } from "@/components/ListingsGrid";
import { ListingHistoryModal } from "@/components/ListingHistoryModal";
import { Pagination } from "@/components/Pagination";
import { ViewToggle } from "@/components/ViewToggle";
import {
  fetchListings,
  fetchTowns,
  fetchPresets,
  createPreset,
  deletePreset as deletePresetApi,
  listingsExportUrl,
} from "@/lib/apiClient";
import { useRefresh } from "@/context/RefreshContext";
import type { Listing, ListingFilters, PaginatedListings, SortField, FilterPreset } from "@/types/listing";
import type { TownOption } from "@/lib/towns";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function ListingsPage() {
  const [towns, setTowns] = useState<TownOption[]>([]);
  const [counties, setCounties] = useState<string[]>([]);
  const [filters, setFilters] = useState<ListingFilters>({});
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [view, setView] = useState<"table" | "grid">("table");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<SortField | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<PaginatedListings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyListing, setHistoryListing] = useState<Listing | null>(null);
  const { refreshKey } = useRefresh();

  useEffect(() => {
    fetchTowns()
      .then((r) => {
        setTowns(r.towns);
        setCounties(r.counties);
      })
      .catch(() => undefined);
    fetchPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => undefined);
  }, [refreshKey]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchListings({ ...filters, sortField, sortDir, page, pageSize })
      .then(setData)
      .catch(() => setError("Failed to load listings. Is the dev server / database reachable?"))
      .finally(() => setLoading(false));
    // refreshKey isn't read in the body — it's a trigger bumped by the nav-bar "Refresh"
    // button so this callback identity changes and the effect below refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortField, sortDir, page, pageSize, refreshKey]);

  useEffect(() => {
    load();
  }, [load]);

  function handleFiltersChange(next: ListingFilters) {
    setFilters(next);
    setPage(1);
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(1);
  }

  async function handleSavePreset(name: string) {
    const { preset } = await createPreset(name, filters);
    setPresets((p) => [preset, ...p]);
  }

  function handleApplyPreset(preset: FilterPreset) {
    setFilters(preset.filters);
    setPage(1);
  }

  async function handleDeletePreset(id: string) {
    await deletePresetApi(id);
    setPresets((p) => p.filter((x) => x.id !== id));
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <FilterPanel
        towns={towns}
        counties={counties}
        filters={filters}
        onChange={handleFiltersChange}
        presets={presets}
        onSavePreset={handleSavePreset}
        onApplyPreset={handleApplyPreset}
        onDeletePreset={handleDeletePreset}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            Listings {data ? <span className="font-normal text-slate-400">({data.total})</span> : null}
          </h1>
          <div className="flex items-center gap-2">
            <a
              href={listingsExportUrl(filters)}
              download
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              title="Download the filtered results as a CSV"
            >
              ⬇ CSV
            </a>
            <ViewToggle view={view} onChange={setView} />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">
            Loading listings…
          </div>
        ) : data ? (
          <>
            {view === "table" ? (
              <ListingsTable
                listings={data.listings}
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                onShowHistory={setHistoryListing}
              />
            ) : (
              <ListingsGrid listings={data.listings} onShowHistory={setHistoryListing} />
            )}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 py-3 text-sm text-slate-500">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="rounded border border-slate-300 px-1.5 py-1 text-sm"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {historyListing && <ListingHistoryModal listing={historyListing} onClose={() => setHistoryListing(null)} />}
    </div>
  );
}
