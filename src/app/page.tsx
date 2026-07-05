"use client";

import { useEffect, useState, useCallback } from "react";
import { FilterPanel } from "@/components/FilterPanel";
import { ListingsTable } from "@/components/ListingsTable";
import { ListingsGrid } from "@/components/ListingsGrid";
import { Pagination } from "@/components/Pagination";
import { ViewToggle } from "@/components/ViewToggle";
import {
  fetchListings,
  fetchTowns,
  fetchPresets,
  createPreset,
  deletePreset as deletePresetApi,
} from "@/lib/apiClient";
import { useRefresh } from "@/context/RefreshContext";
import type { ListingFilters, PaginatedListings, SortField, FilterPreset } from "@/types/listing";
import type { TownInfo } from "@/lib/towns";

const PAGE_SIZE = 25;

export default function ListingsPage() {
  const [towns, setTowns] = useState<TownInfo[]>([]);
  const [filters, setFilters] = useState<ListingFilters>({});
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [view, setView] = useState<"table" | "grid">("table");
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<PaginatedListings | null>(null);
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
    fetchListings({ ...filters, sortField, sortDir, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch(() => setError("Failed to load listings. Is the dev server / database reachable?"))
      .finally(() => setLoading(false));
    // refreshKey isn't read in the body — it's a trigger bumped by the nav-bar "Refresh"
    // button so this callback identity changes and the effect below refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortField, sortDir, page, refreshKey]);

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
    <div className="flex gap-6">
      <FilterPanel
        towns={towns}
        filters={filters}
        onChange={handleFiltersChange}
        presets={presets}
        onSavePreset={handleSavePreset}
        onApplyPreset={handleApplyPreset}
        onDeletePreset={handleDeletePreset}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">
            Listings {data ? <span className="font-normal text-slate-400">({data.total})</span> : null}
          </h1>
          <ViewToggle view={view} onChange={setView} />
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
              <ListingsTable listings={data.listings} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
            ) : (
              <ListingsGrid listings={data.listings} />
            )}
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        ) : null}
      </div>
    </div>
  );
}
