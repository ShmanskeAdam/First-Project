# North NJ Real Estate Tracker

A real estate tracking app for North New Jersey (Bergen, Essex, Hudson, Morris, Passaic, Union, and Somerset
counties): browse listings, filter and sort them, explore market-trend charts, and surface the best current deals
using a configurable scoring model.

See [`CLAUDE.md`](./CLAUDE.md) for the data provider interface, DB schema, and scoring model in depth.

## Stack

- **Framework**: Next.js 14 (App Router), TypeScript, single full-stack app (API routes as the backend)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Database**: Postgres via Prisma — a free [Neon](https://neon.tech) or Vercel Postgres instance works great, or
  any local Postgres for dev

## Getting started

```bash
npm install
cp .env.example .env      # then set DATABASE_URL to a real Postgres connection string
npm run db:push           # create the schema (or npm run db:migrate for tracked migrations)
npm run db:seed           # populate ~700 realistic mock North NJ listings + 2 years of price history
npm run dev                # http://localhost:3000
```

Need a Postgres instance for local dev? The fastest options are a free [Neon](https://neon.tech) project (copy its
connection string into `DATABASE_URL`) or, if you have Postgres installed locally:

```bash
createdb nnj_tracker    # or: psql -c "CREATE DATABASE nnj_tracker;"
# DATABASE_URL="postgresql://<user>@localhost:5432/nnj_tracker"
```

The app works fully offline out of the box — `LISTING_PROVIDER=mock` in `.env` means no API key is required to see
listings, filters, charts, or deal scoring in action.

## Real data without an API key or account

Redfin lets you export search results to CSV directly from your browser, no login required for a normal-sized
search (a free Redfin account raises the row cap if you need it, but isn't required to try this):

1. Go to **redfin.com**, search a NNJ town or county (e.g. "Montclair, NJ"), and apply whatever filters you want
   (for sale, price range, etc.).
2. On the search results page, find **Download All** (usually near the top-left of the results list) and click it
   — this downloads a CSV of the current search.
3. Repeat per town/county to build up coverage — Redfin caps CSV exports at roughly 350 rows without a login, so a
   region-wide search usually needs several smaller exports rather than one giant one.
4. Import each CSV:
   ```bash
   DATABASE_URL="<your Postgres connection string>" npm run import:csv -- ~/Downloads/redfin_export.csv
   ```
   This upserts the rows (by address/MLS#) using the same ingest path a live sync would use, so price-cut
   detection and snapshot history work identically going forward. Safe to run repeatedly with more exports. It
   also **automatically deletes any leftover seeded demo listings** the first time it runs — no separate cleanup
   step needed (`npm run clear:mock` still exists if you ever want to trigger that immediately on its own).
5. Set `LISTING_PROVIDER=static` (in `.env` locally, and as a Vercel env var for your deployment). This matters —
   without it, `LISTING_PROVIDER` defaults to `mock`, and clicking the site's **Refresh** button would fall back
   to regenerating fake listings. `static` makes Refresh a harmless no-op until you wire up a live provider.

The "demo data" banner disappears automatically once real data has been imported (it keys off which provider ran
the most recent sync), and "view listing" links will now resolve to the real Redfin page for each property since
the CSV export includes one.

## Switching to a live API (RentCast)

Set in `.env`:

```
LISTING_PROVIDER="rentcast"
RENTCAST_API_KEY="your-key-here"
```

Get a free-tier key at https://www.rentcast.io/api — this does require creating an account, unlike the CSV path
above. Then run:

```bash
npm run sync
```

This is the fully-automated path: every sync (whether triggered by the CLI, a cron job, or clicking the site's
Refresh button) loops over **every configured North NJ town** (`TOWN_NAMES` in `src/lib/towns.ts`, ~49 towns)
automatically, **upserts by RentCast's own listing ID so re-running never creates duplicates** (it updates the
existing row instead), and — the first time it runs — **clears the seeded demo listings automatically**. Once
`LISTING_PROVIDER=rentcast` and `RENTCAST_API_KEY` are set, clicking Refresh requires no further manual steps
ever again. Re-run `npm run sync` (or click Refresh, or hit `POST /api/sync` from a cron job with the
`x-sync-secret` header set to `SYNC_SECRET`) periodically to keep price/DOM history accumulating for the trend
charts.

## Manual refresh

The nav bar shows "Last refreshed: Xm ago" plus a **Refresh** button any visitor can click to pull fresh listings
on demand (backed by `GET`/`POST /api/sync` and a `SyncStatus` row). Since the button is public-facing, it can't
carry `SYNC_SECRET` (that would mean shipping the secret in client-side JS), so manual clicks are rate-limited to
once per 30 seconds instead — a request that *does* present a valid `x-sync-secret` header (e.g. a cron job) skips
the throttle. See `src/app/api/sync/route.ts`.

Whenever the active provider isn't `mock`, every sync (button click, cron job, or CLI) also automatically deletes
any leftover seeded demo listings first — so switching to `rentcast` or importing real CSV data is fully hands-off
from that point forward, with no separate cleanup step. A one-time "Cleared N demo listings" notice appears next
to the Refresh button the first time this happens.

## Deploying to Vercel

1. Create a Postgres database — easiest is the **Storage** tab in your Vercel project (Neon-backed) or a separate
   free [Neon](https://neon.tech) project — and copy its connection string.
2. Push this repo to GitHub (already done if you're reading this from the tracked branch) and import it at
   https://vercel.com/new.
3. In the Vercel project's Environment Variables, set:
   - `DATABASE_URL` — the Postgres connection string from step 1
   - `LISTING_PROVIDER` — `mock` to launch with demo data, `static` if you've imported real data via a CSV (see
     "Real data without an API key" above) and don't want Refresh reintroducing mock listings, or `rentcast` +
     `RENTCAST_API_KEY` for a live API feed
   - `SYNC_SECRET` — a random string, used to protect any cron-triggered `POST /api/sync` calls
4. Vercel auto-detects the `vercel-build` script in `package.json` (`prisma generate && prisma db push && next build`)
   and uses it instead of `next build`, so the schema is applied to your database on every deploy — no manual
   migration step needed.
5. After the first deploy, seed it once: run `DATABASE_URL="<your prod url>" npm run db:seed` from your machine (or
   any environment that can reach the DB) to populate demo listings. **Don't** add seeding to the build step — the
   seed script wipes and regenerates listings, which would erase any real synced data on every redeploy.
6. To keep trend charts accumulating real history over time, schedule something to hit
   `POST /api/sync` with header `x-sync-secret: <SYNC_SECRET>` periodically — a
   [Vercel Cron Job](https://vercel.com/docs/cron-jobs) is the simplest option on Vercel itself.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / start |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:push` | Push the Prisma schema to Postgres (no migration history) |
| `npm run db:migrate` | Create a tracked migration (use once you're past rapid prototyping) |
| `npm run db:seed` | Wipe and reseed mock data |
| `npm run db:studio` | Prisma Studio, a GUI for the DB |
| `npm run sync` | Pull fresh listings from the active provider and append history |
| `npm run import:csv -- <file>` | One-off import of a Redfin CSV export — no API key needed |
| `npm run clear:mock` | Delete all mock-sourced listings (e.g. before/after a real-data import) |
| `npm run vercel-build` | What Vercel actually runs: generate client, push schema, build |

## App structure

```
src/
  app/                     # pages (Listings, Top Deals, Analytics, Settings) + API routes
  components/              # FilterPanel, ListingsTable/Grid, DealBadge, charts/*
  lib/
    providers/             # ListingProvider interface + mock/RentCast/CSV adapters
    scoring/                # deal-scoring engine + tunable config
    towns.ts               # configurable North NJ town list
    filters.ts, db.ts, ingest.ts, serialize.ts, stats.ts, format.ts, syncStatus.ts
  context/RefreshContext.tsx # nav-bar refresh button + refetch-on-refresh plumbing
  types/listing.ts          # shared TS types
prisma/
  schema.prisma             # Listing, ListingSnapshot, PriceChange, ScoringConfig, FilterPreset, SyncStatus
  seed.ts                    # mock data generator + historical backfill
scripts/
  sync-listings.ts           # provider -> DB sync job (cron entrypoint)
  import-csv.ts              # one-off Redfin CSV import (no API key needed)
  clear-mock-listings.ts     # delete seeded demo listings
```

## Notes

- All API keys are read from environment variables (`.env`, gitignored) — never hardcoded. See `.env.example`.
- The listings/analytics/deals endpoints all use the same `ListingFilters` shape and query-param parsing
  (`src/lib/filters.ts`), so filters behave consistently everywhere they appear.
- Deal-score weights are stored in the DB (`ScoringConfig`, single row) and editable from the Settings page —
  changes take effect immediately on the next request, no restart required.
