"use client";

import clsx from "clsx";
import type { TownOption } from "@/lib/towns";

export function TownMultiSelect({
  towns,
  selected,
  onChange,
  max,
}: {
  towns: TownOption[];
  selected: string[];
  onChange: (towns: string[]) => void;
  max?: number;
}) {
  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((t) => t !== name));
    } else {
      if (max && selected.length >= max) return;
      onChange([...selected, name]);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {towns.map((t) => {
        const active = selected.includes(t.name);
        return (
          <button
            key={t.name}
            type="button"
            onClick={() => toggle(t.name)}
            className={clsx(
              "rounded-full border px-2.5 py-1 text-xs font-medium",
              active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"
            )}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
