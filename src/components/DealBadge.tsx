"use client";

import clsx from "clsx";
import { useState } from "react";
import type { DealScoreResult } from "@/types/listing";

function tierFor(score: number): { label: string; classes: string } {
  if (score >= 75) return { label: "Great deal", classes: "bg-emerald-100 text-emerald-800 border-emerald-300" };
  if (score >= 60) return { label: "Good deal", classes: "bg-lime-100 text-lime-800 border-lime-300" };
  if (score >= 40) return { label: "Fair", classes: "bg-slate-100 text-slate-700 border-slate-300" };
  return { label: "Below avg", classes: "bg-rose-100 text-rose-700 border-rose-300" };
}

export function DealBadge({ dealScore, label }: { dealScore?: DealScoreResult; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!dealScore) return <span className="text-slate-400">—</span>;
  const tier = tierFor(dealScore.score);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-shadow hover:shadow-sm",
          tier.classes
        )}
      >
        {label && <span className="font-normal uppercase tracking-wide opacity-70">{label}</span>}
        <span>{dealScore.score}</span>
        <span className="font-normal">{tier.label}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Why this score{label ? ` (${label})` : ""}
          </p>
          {dealScore.reasons.length === 0 ? (
            <p className="text-sm text-slate-500">No strong signals either way — priced near comps.</p>
          ) : (
            <ul className="space-y-1.5">
              {dealScore.reasons.map((r, i) => (
                <li key={i} className="text-sm text-slate-700">
                  <span className={clsx("font-medium", r.points >= 0 ? "text-emerald-700" : "text-rose-700")}>
                    {r.label}:
                  </span>{" "}
                  {r.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
