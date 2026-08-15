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

## Going live (RentCast) — one paste, zero configuration

Open the deployed site's **Settings** page, paste your RentCast API key (from
[app.rentcast.io](https://app.rentcast.io/app/api)) into the **Data Source** card, and click **Connect**. That
single action:

1. validates the key against RentCast (a rejected key is reported and removed, not stored broken),
2. immediately pulls live listings for **all 7 North NJ counties**,
3. deletes the seeded demo data automatically, and
4. turns on the fully automatic daily refresh (see below).

No Vercel dashboard, no env vars, no redeploy — the key is stored (write-only) in the database and outranks all
env-var configuration. Env vars (`LISTING_PROVIDER=rentcast` + `RENTCAST_API_KEY`) still work as an alternative
for people who prefer them.

### Comprehensive coverage — the whole dataset, every town

- Covers all **10 North NJ counties** — Bergen, Essex, Hudson, Morris, Passaic, Union, Somerset, Sussex, Warren,
  and Hunterdon.
- Queries a **circular geographic area per county** (RentCast supports address / city / zip / lat-long-radius
  searches — it has *no* county filter), and each area **paginates fully** (500/page, RentCast's max, no listing
  cap) — so a full sync pulls the *entire* active for-sale inventory, every municipality included (Boonton,
  Mountain Lakes, and hundreds more, not just a curated shortlist).
- Every listing is filed under the county **RentCast itself reports**, so the county and town filters always
  agree; listings outside the tracked counties are discarded.
- The **town filter options are derived from the data itself** (distinct towns actually present), so every town
  that has listings is selectable and always filters correctly — no hardcoded town list to fall out of sync with
  what RentCast returns.
- **Land-only listings are excluded from Top Deals**: a $1/sqft floor plus a scoring guard mean lots with no
  house (0 sqft) can never masquerade as underpriced deals.
- **Self-healing after upgrades**: the app records a *coverage signature* (query strategy + county list) with
  each full pull. If the deployed site's data was gathered under different rules — older capped pagination, a
  smaller county list, or the pre-fix county query — the very next sync (daily cron or one Refresh click)
  escalates itself to a full all-county pull and **replaces** the stale rows rather than merging with them. No
  redeploy ritual, no manual re-sync command.

### How it stays inside RentCast's free tier (50 requests/month) unattended

- The automatic path pulls **one county per calendar day** on a rolling ~10-day rotation, so the dataset keeps
  refreshing without re-pulling everything daily. Note a *comprehensive* pull of all 10 counties can exceed one
  month of free-tier requests (it is bounded by total inventory ÷ 500 per page, plus overlap between the search
  circles); the budget gate stops it cleanly mid-run and the rotation fills in the remainder, so coverage
  converges over following syncs instead of failing. A paid RentCast tier removes the constraint —
  raise `RENTCAST_MONTHLY_BUDGET` to match.
- A **daily guard** makes repeat Refresh clicks free: once today's county has synced, further clicks are no-ops
  with an explanatory note ("Today's live data is already in").
- A **monthly budget meter** (default 45, override with `RENTCAST_MONTHLY_BUDGET` on a paid plan) is tracked in
  the DB. Each API request is **atomically reserved** — a single conditional SQL `UPDATE` before every network
  call — so the monthly total can never exceed the budget even under concurrent syncs, and pagination simply
  stops mid-run if the budget is hit (the rest fills in on later syncs). This is a provable invariant, not a
  check-before-write. Current usage is shown on the Settings page.
- Duplicates can't happen: every listing upserts by RentCast's own listing ID.

CLI equivalents exist for both modes: `npm run sync` (today's rotating county) and `npm run sync:full` (all 10
counties at once, same budget enforcement).

### Why is a listing I saw on Zillow missing?

RentCast is **not an MLS feed** — they assemble listings from public records, tax assessors, and online
directories (they target ~96% residential coverage but have no direct MLS connection), so some genuine gaps
versus Zillow are expected. That said, a missing listing has three very different causes, and
`npm run diagnose` tells you which one it is by asking RentCast directly:

```bash
npm run diagnose -- --town "Montclair" --address "88 Edgemont Rd, Montclair, NJ 07043"
```

It reports what this app stored, whether RentCast has that exact address (and with what status), how many
listings RentCast has for the town versus what we hold, and whether the county search circle actually reaches
it. The output explains how to read each combination. It costs ~4 API requests, metered against the same
monthly budget as everything else.

Note the sync currently requests `status=Active` only, so pending / under-contract / coming-soon listings —
and all sold listings — are excluded by design.

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
3. In the Vercel project's Environment Variables, the only **required** one is:
   - `DATABASE_URL` — the Postgres connection string from step 1

   Optional hardening / alternatives:
   - `SYNC_SECRET` — a random string; lets manual/CLI `POST /api/sync` calls bypass the 30s public throttle
   - `CRON_SECRET` — a random string; when set, the daily cron endpoint requires Vercel's signed
     `Authorization: Bearer` header instead of being open-but-quota-guarded. Recommended, but the cron works
     without it (the daily/monthly quota guards make an unauthenticated endpoint harmless).
   - `LISTING_PROVIDER` / `RENTCAST_API_KEY` — env-var alternative to pasting the key on the Settings page
   - `RENTCAST_MONTHLY_BUDGET` — raise the request budget if you're on a paid RentCast plan
4. Vercel auto-detects the `vercel-build` script in `package.json` (`prisma generate && prisma db push && next build`)
   and uses it instead of `next build`, so the schema is applied to your database on every deploy — no manual
   migration step needed.
5. After the first deploy, seed it once: run `DATABASE_URL="<your prod url>" npm run db:seed` from your machine (or
   any environment that can reach the DB) to populate demo listings. **Don't** add seeding to the build step — the
   seed script wipes and regenerates listings, which would erase any real synced data on every redeploy. (This step
   is optional if you're going straight to live data — connecting RentCast on the Settings page fills the site
   with real listings immediately.)
6. `vercel.json` already configures a daily Vercel Cron Job hitting `GET /api/cron/sync` at 9am UTC
   (`"0 9 * * *"` — the max frequency Vercel's free Hobby plan allows, and exactly the right cadence for
   RentCast's quota). It runs automatically on deploy with **no configuration at all**; the site's Refresh button
   still works for on-demand pulls in between, and both share the same quota guards.

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
| `npm run sync` | Pull today's rotating county (RentCast) or all towns (other providers) |
| `npm run sync:full` | Full sync across all 10 North NJ counties at once (costs more quota) |
| `npm run diagnose` | Ask RentCast why a town/address is missing (see "Why is a listing missing?") |
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
    towns.ts               # configurable North NJ town list + county grouping
    syncRotation.ts        # day -> county picker so RentCast syncs stay under quota
    filters.ts, db.ts, ingest.ts, serialize.ts, stats.ts, format.ts, syncStatus.ts
  context/RefreshContext.tsx # nav-bar refresh button + refetch-on-refresh plumbing
  types/listing.ts          # shared TS types
prisma/
  schema.prisma             # Listing, ListingSnapshot, PriceChange, ScoringConfig, FilterPreset, SyncStatus
  seed.ts                    # mock data generator + historical backfill
scripts/
  sync-listings.ts           # daily provider -> DB sync job (cron entrypoint)
  sync-full.ts                # one-time full sync across all counties/towns
  import-csv.ts              # one-off Redfin CSV import (no API key needed)
  clear-mock-listings.ts     # delete seeded demo listings
```

## Notes

- All API keys are read from environment variables (`.env`, gitignored) — never hardcoded. See `.env.example`.
- The listings/analytics/deals endpoints all use the same `ListingFilters` shape and query-param parsing
  (`src/lib/filters.ts`), so filters behave consistently everywhere they appear.
- Deal-score weights are stored in the DB (`ScoringConfig`, single row) and editable from the Settings page —
  changes take effect immediately on the next request, no restart required.
