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

## Switching to live data

Set in `.env`:

```
LISTING_PROVIDER="rentcast"
RENTCAST_API_KEY="your-key-here"
```

Get a free-tier key at https://www.rentcast.io/api. Then run:

```bash
npm run sync
```

This fetches current listings for every configured town (see `src/lib/towns.ts`) and upserts them into the DB,
recording any price changes and appending a `ListingSnapshot` row per listing — the raw material for the trend
charts. Re-run `npm run sync` periodically (cron, a systemd timer, Vercel Cron hitting `POST /api/sync` with the
`x-sync-secret` header set to `SYNC_SECRET`) to keep history accumulating.

You can also import a Redfin "Download All" CSV export (a feature Redfin explicitly permits) via
`CsvListingProvider` in `src/lib/providers/csvProvider.ts` — see CLAUDE.md for how to wire it into the sync script.

## Manual refresh

The nav bar shows "Last refreshed: Xm ago" plus a **Refresh** button any visitor can click to pull fresh listings
on demand (backed by `GET`/`POST /api/sync` and a `SyncStatus` row). Since the button is public-facing, it can't
carry `SYNC_SECRET` (that would mean shipping the secret in client-side JS), so manual clicks are rate-limited to
once per 30 seconds instead — a request that *does* present a valid `x-sync-secret` header (e.g. a cron job) skips
the throttle. See `src/app/api/sync/route.ts`.

## Deploying to Vercel

1. Create a Postgres database — easiest is the **Storage** tab in your Vercel project (Neon-backed) or a separate
   free [Neon](https://neon.tech) project — and copy its connection string.
2. Push this repo to GitHub (already done if you're reading this from the tracked branch) and import it at
   https://vercel.com/new.
3. In the Vercel project's Environment Variables, set:
   - `DATABASE_URL` — the Postgres connection string from step 1
   - `LISTING_PROVIDER` — `mock` to launch with demo data, or `rentcast` + `RENTCAST_API_KEY` for live data
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
scripts/sync-listings.ts     # provider -> DB sync job (cron entrypoint)
```

## Notes

- All API keys are read from environment variables (`.env`, gitignored) — never hardcoded. See `.env.example`.
- The listings/analytics/deals endpoints all use the same `ListingFilters` shape and query-param parsing
  (`src/lib/filters.ts`), so filters behave consistently everywhere they appear.
- Deal-score weights are stored in the DB (`ScoringConfig`, single row) and editable from the Settings page —
  changes take effect immediately on the next request, no restart required.
