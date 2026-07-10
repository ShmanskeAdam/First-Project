"use client";

import { useEffect, useState } from "react";
import { fetchSettings, updateSettings, connectRentcast, type DataSourceStatus } from "@/lib/apiClient";
import { useRefresh } from "@/context/RefreshContext";
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

function DataSourceCard({
  dataSource,
  onStatusChange,
}: {
  dataSource: DataSourceStatus;
  onStatusChange: (s: DataSourceStatus) => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const { refresh } = useRefresh();

  async function handleConnect() {
    if (!keyInput.trim()) return;
    setConnecting(true);
    setMessage(null);
    try {
      const result = await connectRentcast(keyInput.trim());
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error ?? "Failed to connect RentCast." });
      } else {
        onStatusChange(result.dataSource);
        setKeyInput("");
        if (result.warning) {
          setMessage({ kind: "warn", text: result.warning });
        } else {
          setMessage({
            kind: "ok",
            text: result.sync
              ? `Connected! Pulled ${result.sync.fetched?.toLocaleString()} live listings across North NJ.${
                  result.sync.clearedMockListings > 0
                    ? ` Removed ${result.sync.clearedMockListings.toLocaleString()} demo listings.`
                    : ""
                } From here on, data refreshes automatically every day.`
              : "Connected.",
          });
        }
        // Re-pull sync status + page data so the whole UI reflects live data immediately.
        void refresh().catch(() => undefined);
      }
    } catch {
      setMessage({ kind: "error", text: "Failed to connect RentCast." });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setConnecting(true);
    setMessage(null);
    try {
      const result = await connectRentcast("");
      if (result.ok) {
        onStatusChange(result.dataSource);
        setMessage({ kind: "ok", text: "RentCast disconnected. The site keeps the data already pulled." });
      }
    } finally {
      setConnecting(false);
    }
  }

  const usage = dataSource.rentcastUsage;

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-1 text-base font-semibold text-slate-900">Data Source</h2>
      {dataSource.rentcastConfigured ? (
        <>
          <p className="mb-3 text-sm text-emerald-700">
            ✓ RentCast connected {dataSource.rentcastKeyHint && <span className="text-slate-400">({dataSource.rentcastKeyHint})</span>}
            {" — live listings pull automatically once a day."}
          </p>
          <p className="mb-3 text-xs text-slate-500">
            API budget this month: <span className="font-medium text-slate-700">{usage.used} / {usage.budget}</span> requests. The
            site pulls one county per day on a weekly rotation and hard-stops at the budget, so it can never exceed
            RentCast&apos;s free tier on its own.
          </p>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={connecting}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            Currently showing <span className="font-medium">demo data</span>. Paste your RentCast API key (from{" "}
            <a href="https://app.rentcast.io/app/api" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
              app.rentcast.io
            </a>
            ) to switch to live North NJ listings — this immediately pulls all 7 counties, deletes the demo data,
            and turns on automatic daily refreshes. One paste, nothing else to configure.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="RentCast API key"
              className="w-full max-w-sm rounded border border-slate-300 px-3 py-1.5 text-sm"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting || !keyInput.trim()}
              className="shrink-0 rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {connecting ? "Connecting… (pulling live data)" : "Connect"}
            </button>
          </div>
        </>
      )}
      {message && (
        <p
          className={`mt-3 text-sm ${
            message.kind === "ok" ? "text-emerald-700" : message.kind === "warn" ? "text-amber-700" : "text-rose-600"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [dataSource, setDataSource] = useState<DataSourceStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((r) => {
        setConfig(r.config);
        setDataSource(r.dataSource);
      })
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
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Settings</h1>

      {dataSource && <DataSourceCard dataSource={dataSource} onStatusChange={setDataSource} />}

      <h2 className="mb-1 text-base font-semibold text-slate-900">Deal Score Weights</h2>
      <p className="mb-4 text-sm text-slate-500">
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
