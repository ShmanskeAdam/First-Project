"use client";

import { useEffect, useState } from "react";
import { fetchSettings, updateSettings } from "@/lib/apiClient";
import type { ScoringConfig } from "@/types/listing";

const WEIGHT_FIELDS: { key: keyof ScoringConfig; label: string; description: string }[] = [
  {
    key: "pricePerSqftWeight",
    label: "Price/sqft vs. comps",
    description: "How much weight to give a listing being priced below (or above) similar homes in the same town.",
  },
  {
    key: "priceCutWeight",
    label: "Price cut magnitude & recency",
    description: "How much weight to give a recent, sizable price reduction.",
  },
  {
    key: "domWeight",
    label: "Days on market",
    description: "How much weight staleness (combined with price positioning) carries.",
  },
  {
    key: "compSalesWeight",
    label: "Comparable sold prices",
    description: "How much weight recent comparable sales in the same town/type/bed cohort carry.",
  },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((r) => setConfig(r.config))
      .catch(() => setError("Failed to load scoring settings."));
  }, []);

  const weightSum = config
    ? WEIGHT_FIELDS.reduce((sum, f) => sum + (config[f.key] as number), 0)
    : 0;

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const { config: saved } = await updateSettings(config);
      setConfig(saved);
      setSavedAt(Date.now());
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">Loading…</div>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Deal Score Settings</h1>
      <p className="mb-6 text-sm text-slate-500">
        Tune how much each signal contributes to a listing&apos;s deal score. Weights don&apos;t need to sum to
        exactly 1 — the final score is normalized — but keeping them close to 1 makes the 0–100 scale easiest to
        reason about.
      </p>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between text-xs text-slate-500">
          <span>Current weight sum</span>
          <span className={weightSum > 1.3 || weightSum < 0.7 ? "font-semibold text-amber-600" : ""}>
            {weightSum.toFixed(2)}
          </span>
        </div>

        {WEIGHT_FIELDS.map((f) => (
          <div key={f.key} className="mb-5">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-800">{f.label}</label>
              <span className="text-sm text-slate-500">{(config[f.key] as number).toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={config[f.key] as number}
              onChange={(e) => setConfig({ ...config, [f.key]: Number(e.target.value) })}
              className="w-full"
            />
            <p className="mt-1 text-xs text-slate-500">{f.description}</p>
          </div>
        ))}

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-200 pt-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Price-cut recency window</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={config.priceCutRecencyDays}
                onChange={(e) => setConfig({ ...config, priceCutRecencyDays: Number(e.target.value) })}
                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <span className="text-sm text-slate-500">days</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Price cuts older than this no longer boost the score.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Comp-sale lookback</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={config.compSaleLookbackMonths}
                onChange={(e) => setConfig({ ...config, compSaleLookbackMonths: Number(e.target.value) })}
                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <span className="text-sm text-slate-500">months</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">How far back to look for comparable sold properties.</p>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save weights"}
          </button>
          {savedAt && !saving && <span className="text-sm text-emerald-600">Saved.</span>}
        </div>
      </div>
    </div>
  );
}
