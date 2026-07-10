"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { RangeSlider } from "./RangeSlider";
import type { TownOption } from "@/lib/towns";
import type { ListingFilters, FilterPreset, PropertyType } from "@/types/listing";
import { PROPERTY_TYPE_LABELS, formatCompactCurrency } from "@/lib/format";

const PROPERTY_TYPES: PropertyType[] = ["SINGLE_FAMILY", "MULTI_FAMILY", "CONDO", "TOWNHOUSE"];

const BOUNDS = {
  price: { min: 0, max: 3_000_000, step: 10_000 },
  ppsf: { min: 0, max: 1000, step: 5 },
  sqft: { min: 0, max: 6000, step: 50 },
  lot: { min: 0, max: 40_000, step: 500 },
  year: { min: 1880, max: 2026, step: 1 },
  dom: { min: 0, max: 365, step: 1 },
  transit: { min: 0, max: 15, step: 0.5 },
  hoa: { min: 0, max: 1000, step: 25 },
};

interface FilterPanelProps {
  towns: TownOption[];
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  presets: FilterPreset[];
  onSavePreset: (name: string) => void;
  onApplyPreset: (preset: FilterPreset) => void;
  onDeletePreset: (id: string) => void;
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-slate-800"
      >
        {title}
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** How many filters are actively set — shown on the mobile "Filters" button. */
function countActiveFilters(filters: ListingFilters): number {
  return Object.values(filters).filter((v) => v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0))
    .length;
}

export function FilterPanel({
  towns,
  filters,
  onChange,
  presets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: FilterPanelProps) {
  const [townSearch, setTownSearch] = useState("");
  const [presetName, setPresetName] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const filteredTowns = useMemo(
    () => towns.filter((t) => t.name.toLowerCase().includes(townSearch.toLowerCase())),
    [towns, townSearch]
  );

  const townsByCounty = useMemo(() => {
    const map = new Map<string, TownOption[]>();
    for (const t of filteredTowns) {
      const arr = map.get(t.county);
      if (arr) arr.push(t);
      else map.set(t.county, [t]);
    }
    return map;
  }, [filteredTowns]);

  function set<K extends keyof ListingFilters>(key: K, value: ListingFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  function toggleInArray<T extends string>(key: keyof ListingFilters, value: T) {
    const current = (filters[key] as T[] | undefined) ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    set(key, (next.length ? next : undefined) as ListingFilters[typeof key]);
  }

  const activeCount = countActiveFilters(filters);

  return (
    <>
      {/* Mobile: filters live behind a toggle so the listings aren't pushed off-screen. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="mb-3 inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 lg:hidden"
      >
        ☰ Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-white">{activeCount}</span>
        )}
      </button>

      <aside
        className={clsx(
          "w-80 shrink-0 rounded-lg border border-slate-200 bg-white p-4",
          mobileOpen
            ? "fixed inset-0 z-40 w-full overflow-y-auto rounded-none"
            : "hidden lg:block"
        )}
      >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Filters</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Reset all
          </button>
          {mobileOpen && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white lg:hidden"
            >
              Done
            </button>
          )}
        </div>
      </div>

      <Section title="Saved presets">
        <div className="space-y-1.5">
          {presets.length === 0 && <p className="text-xs text-slate-400">No saved presets yet.</p>}
          {presets.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5">
              <button
                type="button"
                onClick={() => onApplyPreset(p)}
                className="truncate text-left text-sm text-slate-700 hover:text-brand-700"
                title={p.name}
              >
                {p.name}
              </button>
              <button
                type="button"
                onClick={() => onDeletePreset(p.id)}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="mt-2 flex gap-1.5">
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={!presetName.trim()}
              onClick={() => {
                onSavePreset(presetName.trim());
                setPresetName("");
              }}
              className="shrink-0 rounded bg-brand-600 px-2.5 py-1 text-sm font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </Section>

      <Section title="Town / Municipality">
        <input
          value={townSearch}
          onChange={(e) => setTownSearch(e.target.value)}
          placeholder="Search towns..."
          className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <div className="max-h-56 overflow-y-auto pr-1">
          {Array.from(townsByCounty.entries()).map(([county, list]) => (
            <div key={county} className="mb-2">
              <p className="mb-1 text-xs font-semibold text-slate-400">{county} County</p>
              {list.map((t) => (
                <label key={t.name} className="flex items-center gap-2 py-0.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={(filters.towns ?? []).includes(t.name)}
                    onChange={() => toggleInArray("towns", t.name)}
                    className="accent-brand-600"
                  />
                  {t.name}
                </label>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Property type">
        <div className="flex flex-wrap gap-2">
          {PROPERTY_TYPES.map((pt) => {
            const active = (filters.propertyTypes ?? []).includes(pt);
            return (
              <button
                key={pt}
                type="button"
                onClick={() => toggleInArray("propertyTypes", pt)}
                className={clsx(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"
                )}
              >
                {PROPERTY_TYPE_LABELS[pt]}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          {(["ACTIVE", "PENDING", "SOLD"] as const).map((s) => {
            const active = (filters.statuses ?? []).includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleInArray("statuses", s)}
                className={clsx(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"
                )}
              >
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!!filters.priceCutOnly}
            onChange={(e) => set("priceCutOnly", e.target.checked || undefined)}
            className="accent-brand-600"
          />
          Only show listings with a price cut
        </label>
      </Section>

      <Section title="Price">
        <RangeSlider
          label="List price"
          min={BOUNDS.price.min}
          max={BOUNDS.price.max}
          step={BOUNDS.price.step}
          value={[filters.minPrice ?? BOUNDS.price.min, filters.maxPrice ?? BOUNDS.price.max]}
          onChange={([lo, hi]) => onChange({ ...filters, minPrice: lo, maxPrice: hi })}
          format={formatCompactCurrency}
        />
        <RangeSlider
          label="Price / sqft"
          min={BOUNDS.ppsf.min}
          max={BOUNDS.ppsf.max}
          step={BOUNDS.ppsf.step}
          value={[filters.minPricePerSqft ?? BOUNDS.ppsf.min, filters.maxPricePerSqft ?? BOUNDS.ppsf.max]}
          onChange={([lo, hi]) => onChange({ ...filters, minPricePerSqft: lo, maxPricePerSqft: hi })}
          format={(n) => `$${n}`}
        />
      </Section>

      <Section title="Beds / Baths">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Min beds</label>
            <select
              value={filters.minBeds ?? ""}
              onChange={(e) => set("minBeds", e.target.value ? Number(e.target.value) : undefined)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Any</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Min baths</label>
            <select
              value={filters.minBaths ?? ""}
              onChange={(e) => set("minBaths", e.target.value ? Number(e.target.value) : undefined)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Any</option>
              {[1, 1.5, 2, 2.5, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section title="Size & lot" defaultOpen={false}>
        <RangeSlider
          label="Square footage"
          min={BOUNDS.sqft.min}
          max={BOUNDS.sqft.max}
          step={BOUNDS.sqft.step}
          value={[filters.minSqft ?? BOUNDS.sqft.min, filters.maxSqft ?? BOUNDS.sqft.max]}
          onChange={([lo, hi]) => onChange({ ...filters, minSqft: lo, maxSqft: hi })}
          format={(n) => `${n.toLocaleString()} sf`}
        />
        <RangeSlider
          label="Lot size"
          min={BOUNDS.lot.min}
          max={BOUNDS.lot.max}
          step={BOUNDS.lot.step}
          value={[filters.minLotSize ?? BOUNDS.lot.min, filters.maxLotSize ?? BOUNDS.lot.max]}
          onChange={([lo, hi]) => onChange({ ...filters, minLotSize: lo, maxLotSize: hi })}
          format={(n) => `${n.toLocaleString()} sf`}
        />
        <RangeSlider
          label="Year built"
          min={BOUNDS.year.min}
          max={BOUNDS.year.max}
          step={BOUNDS.year.step}
          value={[filters.minYearBuilt ?? BOUNDS.year.min, filters.maxYearBuilt ?? BOUNDS.year.max]}
          onChange={([lo, hi]) => onChange({ ...filters, minYearBuilt: lo, maxYearBuilt: hi })}
        />
      </Section>

      <Section title="Market activity" defaultOpen={false}>
        <RangeSlider
          label="Days on market"
          min={BOUNDS.dom.min}
          max={BOUNDS.dom.max}
          step={BOUNDS.dom.step}
          value={[filters.minDom ?? BOUNDS.dom.min, filters.maxDom ?? BOUNDS.dom.max]}
          onChange={([lo, hi]) => onChange({ ...filters, minDom: lo, maxDom: hi })}
          format={(n) => `${n}d`}
        />
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Min school rating
          </label>
          <select
            value={filters.minSchoolRating ?? ""}
            onChange={(e) => set("minSchoolRating", e.target.value ? Number(e.target.value) : undefined)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {[5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Commute & extras" defaultOpen={false}>
        <RangeSlider
          label="Max distance to transit"
          min={BOUNDS.transit.min}
          max={BOUNDS.transit.max}
          step={BOUNDS.transit.step}
          value={[0, filters.maxTransitDistanceMiles ?? BOUNDS.transit.max]}
          onChange={([, hi]) => set("maxTransitDistanceMiles", hi)}
          format={(n) => `${n} mi`}
        />
        <RangeSlider
          label="Max HOA fee / mo"
          min={BOUNDS.hoa.min}
          max={BOUNDS.hoa.max}
          step={BOUNDS.hoa.step}
          value={[0, filters.maxHoaFee ?? BOUNDS.hoa.max]}
          onChange={([, hi]) => set("maxHoaFee", hi)}
          format={(n) => `$${n}`}
        />
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Min garage spaces
          </label>
          <select
            value={filters.minGarageSpaces ?? ""}
            onChange={(e) => set("minGarageSpaces", e.target.value ? Number(e.target.value) : undefined)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Address search" defaultOpen={false}>
        <input
          value={filters.search ?? ""}
          onChange={(e) => set("search", e.target.value || undefined)}
          placeholder="Search by address..."
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </Section>

      {mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="mt-4 w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white lg:hidden"
        >
          Show results
        </button>
      )}
      </aside>
    </>
  );
}
