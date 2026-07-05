"use client";

import clsx from "clsx";

export function ViewToggle({ view, onChange }: { view: "table" | "grid"; onChange: (v: "table" | "grid") => void }) {
  return (
    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
      {(["table", "grid"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={clsx(
            "rounded px-3 py-1 text-sm font-medium capitalize",
            view === v ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
