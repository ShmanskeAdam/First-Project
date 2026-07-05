"use client";

interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  format?: (n: number) => string;
}

/**
 * Dual-thumb range slider (two overlapping native <input type="range"> with the
 * inactive track hidden via pointer-events) plus paired min/max number inputs.
 * Renders fine in Chromium/WebKit; Firefox's ::-moz-range-thumb isn't targeted
 * here so both thumbs may sit on one track there, but the number inputs still work.
 */
export function RangeSlider({ label, min, max, step, value, onChange, format }: RangeSliderProps) {
  const [lo, hi] = value;
  const fmt = format ?? ((n: number) => String(n));
  const pctLo = ((lo - min) / (max - min || 1)) * 100;
  const pctHi = ((hi - min) / (max - min || 1)) * 100;

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
        <span className="text-xs text-slate-500">
          {fmt(lo)} – {fmt(hi)}
        </span>
      </div>

      <div className="relative mb-2 h-5">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-slate-200" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-brand-500"
          style={{ left: `${pctLo}%`, right: `${100 - pctHi}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={(e) => {
            const next = Math.min(Number(e.target.value), hi);
            onChange([next, hi]);
          }}
          className="pointer-events-none absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-20 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-600 [&::-webkit-slider-thumb]:bg-white"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={(e) => {
            const next = Math.max(Number(e.target.value), lo);
            onChange([lo, next]);
          }}
          className="pointer-events-none absolute inset-0 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-20 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-600 [&::-webkit-slider-thumb]:bg-white"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          value={lo}
          min={min}
          max={hi}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <span className="text-slate-400">–</span>
        <input
          type="number"
          value={hi}
          min={lo}
          max={max}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}
