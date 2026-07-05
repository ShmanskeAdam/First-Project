"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
      <p className="mb-2 font-semibold text-rose-800">Something went wrong.</p>
      <p className="mb-4 text-sm text-rose-600">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}
