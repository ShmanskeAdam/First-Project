# CLAUDE.md — North NJ Real Estate Tracker

Context for future sessions working on this codebase. Read this before making structural changes to the data
layer, the scoring engine, or the DB schema.

## What this app is

A tracker for residential listings across North New Jersey (Bergen, Essex, Hudson, Morris, Passaic, Union, and
Somerset counties): a filterable/sortable listings table+grid, a market analytics dashboard (price/DOM/inventory
trends, histograms, town comparisons), and a "Top Deals" leaderboard driven by a configurable scoring model.

Stack: Next.js 14 App Router (TS) as a single full-stack app — pages under `src/app/*`, API route handlers under
`src/app/api/*/route.ts`. Prisma + **Postgres** for storage (originally SQLite; migrated to Postgres so the app can
run on Vercel, whose serverless functions have an ephemeral/read-only filesystem that a SQLite file can't survive —
see "Deployment" below). `propertyType`/`status` are still plain `String` columns rather than native Postgres
enums, a holdover from the SQLite days kept for engine-portability. Tailwind for styling, Recharts for charts.

## Data provider interface

Everything the app knows about a listing's data source is behind `ListingProvider` in
`src/lib/providers/types.ts`:

```ts
interface ListingProvider {
  readonly key: string; // stored on Listing.source, e.g. "mock" | "rentcast" | "csv:redfin"
  fetchListings(query?: { towns?: string[]; limit?: number }): Promise<RawListing[]>;
}
```

`RawListing` is the normalized shape every provider must produce (address, town, county, price, beds/baths/sqft,
propertyType, status, listedDate, the NJ-specific extras below, etc). Nothing downstream of `fetchListings()` knows
or cares which vendor the data came from.

Implementations, all in `src/lib/providers/`:

- **`MockListingProvider`** (`mockProvider.ts`) — the default (`LISTING_PROVIDER=mock`, no key needed).
  Deterministic (seeded PRNG) generator covering every town in `src/lib/towns.ts`, producing active/pending/sold
  listings with realistic price-per-town tiers, ~30% of active listings carrying 1-2 price cuts, and — uniquely —
  a `generateWithHistory()` method that also returns synthetic weekly snapshot history per listing. That history is
  what `prisma/seed.ts` uses to backfill ~2 years of `ListingSnapshot`/`PriceChange` rows so the trend charts have
  something to show on a fresh clone with zero API calls.
- **`RentCastListingProvider`** (`rentcastProvider.ts`) — live data via https://www.rentcast.io/api.
  The normal activation path is pasting the API key into the **Settings page's Data Source card**, which stores it
  in the `AppConfig` DB row (`src/lib/appConfig.ts`); `getActiveProvider()` checks that key *first*, before any
  env var, so going live needs no redeploy. (`LISTING_PROVIDER=rentcast` + `RENTCAST_API_KEY` env vars still work
  as a fallback.) The key is write-only: `GET /api/settings` reports only `rentcastConfigured` + a last-4 hint,
  never the key. Connecting validates the key by immediately running a full sync — a 401/403 raises
  `RentCastAuthError`, which the settings route catches to un-store the bad key and report it.
  Calls `GET /listings/sale` **per county** (`county` + `state` params), not per town — RentCast's free tier caps
  out at 50 requests/month, and this app tracks 51 towns across only 7 counties, so a per-town query would blow
  the entire monthly quota in a single sync. `fetchListings` requires an explicit `counties` list
  (`ListingProviderQuery.counties`) and paginates via `limit`/`offset` (500/page, RentCast's max) up to
  `maxPagesPerArea` pages per county (default 2 — page 2 is only fetched when page 1 comes back exactly full).
  The provider exposes `lastFetchRequestCount`, which `runSync` meters into the monthly budget (below).
  - `getDefaultSyncQuery()` (`providers/index.ts`) is what the automatic path (Refresh button, `npm run sync`,
    cron) actually uses: **one county per calendar day**, picked deterministically by `src/lib/syncRotation.ts`
    (`getTodaysCounty()`, a `dayOfYear % 7` index into `COUNTIES`). That's 1-2 requests/day ≈ 30-38/month.
    Full North NJ coverage still happens, just on a rolling ~weekly basis per county rather than instantly.
  - `getFullSyncQuery()` is the opt-in alternative used by the connect flow and `npm run sync:full`: all 7
    counties at once with `maxPagesPerArea: 2` (≤14 requests). Costs more quota per run, so it's deliberately not
    part of the automatic/daily path.
- **`CsvListingProvider`** (`csvProvider.ts`) — parses a Redfin "Download All" CSV export (a feature Redfin
  explicitly permits, and the only real-data path that needs no API key or account) into `RawListing[]`. Not wired
  into `getActiveProvider()` since it takes a CSV string rather than reading env config; `scripts/import-csv.ts` is
  the one-off entrypoint (`npm run import:csv -- <file>`), used the same way an interactive session would set it
  up. Redfin doesn't supply a "listed date," only a "days on market" figure as of export time — `fetchListings`
  back-dates `listedDate` from that (from the sale date for sold rows, from "now" otherwise) so `ingest.ts`'s own
  DOM computation comes out correct instead of every imported row reading as freshly listed.
- **`StaticListingProvider`** (defined inline in `providers/index.ts`) — a no-op provider (`fetchListings` always
  returns `[]`) selected via `LISTING_PROVIDER=static`. Exists so that after a one-off CSV import, clicking the
  site's Refresh button doesn't fall through to the "mock" default and silently regenerate fake listings on top of
  the real ones just imported. `scripts/clear-mock-listings.ts` (`npm run clear:mock`) deletes any leftover
  mock-sourced rows (cascades to their snapshots/price changes) on demand, though this now also happens
  automatically (see `clearMockListingsIfLiveSource` below).

`src/lib/providers/index.ts` → `getActiveProvider()` (async — it reads the DB-stored key first, then falls back to
`LISTING_PROVIDER`, defaulting to `"mock"`). **Do not build a Zillow scraper** — Zillow's ToS prohibits it.
RentCast/RapidAPI resellers, ATTOM, and Redfin's CSV export are the sanctioned paths; see the README for how to
add another RapidAPI-based provider (same pattern as `rentcastProvider.ts`).

### Ingestion pipeline

`src/lib/ingest.ts` → `ingestRawListings(raws, source)` is the single place that turns provider output into DB
rows, and it is **batched**: ~8 queries total (dedupe in-batch → one findMany of existing rows → createMany new →
per-row updates only for materially-changed rows → createMany PriceChanges → createMany Snapshots → one bulk
lastSeenAt bump → one raw-SQL DOM refresh) instead of ~4 queries *per listing*. The naive per-row loop it replaced
was ~3,000 sequential round trips for a 700-listing sync — fine locally, but guaranteed to blow past serverless
time limits against network-attached Postgres (Neon) on Vercel; the batched version ingests 1,000 listings in
under a second. The final raw-SQL statement recomputes `daysOnMarket` for every ACTIVE/PENDING row from
`listedDate`, so DOM stays fresh across the whole table even though only one county syncs per day. Deduplication
is inherent to the `(source, externalId)` unique key — re-syncing the same property updates it in place, never
duplicates it — plus an in-batch dedupe for providers whose pagination can return the same row twice.

`ingest.ts` also exports `clearMockListingsIfLiveSource(activeSource)`: if the active provider isn't `"mock"`, it
deletes every `source: "mock"` listing (a no-op once none remain), so switching from demo data to a real source is
fully hands-off.

### Sync orchestration (`src/lib/runSync.ts`)

`runSync(mode)` is the ONE sync implementation, called by all five triggers: the UI Refresh button
(`POST /api/sync`), the Vercel cron (`GET /api/cron/sync`), the Settings connect flow (mode "full"), and the two
CLI scripts. It layers RentCast-only quota guards on top of fetch→ingest→clear-mock→record-status:

- **Daily guard** (mode "daily"): if a RentCast sync already succeeded today (UTC), the run is a no-op returning
  `skipped: true` and a human note — so unlimited Refresh clicks cost at most one county's requests per day.
- **Monthly budget**: `AppConfig.requestsThisMonth` meters actual request counts (via the provider's
  `lastFetchRequestCount`); runs that could exceed the budget (default 45, env `RENTCAST_MONTHLY_BUDGET`) are
  refused with `skipped: true`. The app therefore *cannot* overrun RentCast's free tier unattended.
- Every result carries a `note` string that `RefreshContext` surfaces next to the Refresh button ("Pulled Essex
  County (512 listings)", "Today's live data is already in…", "Cleared 732 demo listings…").

Auth differs per trigger: `POST /api/sync` rate-limits anonymous callers to one sync per 30s
(`MIN_MANUAL_INTERVAL_MS`) and lets a valid `x-sync-secret` header bypass the throttle; `GET /api/cron/sync`
requires Vercel's `Authorization: Bearer <CRON_SECRET>` header **only if** `CRON_SECRET` is set — unset, it stays
open so the daily cron works with zero configuration (safe because the quota guards make hammering it pointless).
Both sync routes set `export const maxDuration = 60`.

`RefreshContext` (`src/context/RefreshContext.tsx`) exposes a `refreshKey` that every page's data-fetch effect
depends on, so clicking Refresh re-fetches in place without a full page reload.

`prisma/seed.ts` bypasses `ingest.ts` — it writes many `ListingSnapshot` rows per listing at once (from
`generateWithHistory()`) instead of one-per-sync, since seeding needs to backfill history that never "really"
happened incrementally.

## Database schema (`prisma/schema.prisma`)

- **`Listing`** — current state, one row per real-world property. Unique on `(source, externalId)`. `propertyType`
  (`SINGLE_FAMILY | MULTI_FAMILY | CONDO | TOWNHOUSE`) and `status` (`ACTIVE | PENDING | SOLD`) are plain `String`
  columns rather than native Postgres enums (typed as unions at the TS layer, `src/types/listing.ts`) — a holdover
  from when this ran on SQLite, kept for engine-portability. Includes the NJ-buyer-specific fields: `hoaFee`,
  `garageSpaces`, `transitStationName`/`transitDistanceMiles` (commute/transit proximity), `schoolRating`.
- **`ListingSnapshot`** — one row per listing per sync run (`capturedAt`, `status`, `listPrice`, `pricePerSqft`,
  `daysOnMarket`, plus denormalized `town`/`propertyType` for fast group-by). This is the *only* source for every
  time-series chart — median price over time, $/sqft trends, inventory levels, DOM trends — all computed by
  grouping snapshot rows by month (see `/api/analytics/trends`). There is deliberately no separate pre-aggregated
  "MarketTrend" table; aggregation happens on read.
- **`PriceChange`** — one row per detected price drop/change (`oldPrice`, `newPrice`, `changedAt`). Drives both the
  "price cut" column in the listings table and the price-cut signal in deal scoring.
- **`ScoringConfig`** — single row (`id: "default"`) holding the deal-score weights described below. Edited from
  the Settings page via `GET`/`PUT /api/settings`.
- **`FilterPreset`** — saved filter sets (`name`, `filters` as a JSON-encoded `ListingFilters` blob).
- **`SyncStatus`** — single row (`id: "default"`) tracking the most recent sync (`lastSyncedAt`, `provider`,
  `fetched`, `ingested`), written by every sync path and read by the nav bar's "Last refreshed" indicator. Also
  what the daily guard checks ("did a rentcast sync already happen today?").
- **`AppConfig`** — single row (`id: "default"`): `rentcastApiKey` (write-only via the Settings page; never
  echoed by any API) plus `requestsThisMonth`/`requestMonth`, the RentCast monthly budget meter. Being DB-stored
  is the whole point: connecting live data and enforcing quota both survive redeploys and require no env-var
  changes. Note the trade-off accepted here: `PUT /api/settings` is unauthenticated (like the scoring weights
  always were), so a stranger could *overwrite* the key — but never read it, and the budget meter bounds any
  abuse; re-pasting recovers.

## Deal-scoring engine (`src/lib/scoring/`)

`dealScore.ts` is the core algorithm; `service.ts` wires it to the DB (builds comp cohorts from the *entire*
market, not just the current filtered/paginated view — comps must reflect the real town/type/bed market).

**Every listing gets two independent scores**, not one: `dealScoreTown` (comps drawn from the listing's own town)
and `dealScoreNj` (comps drawn from the entire North NJ market, town-agnostic). Both run the exact same weighted
algorithm below — they differ only in which `CompIndex` cohort lookup (`ScoreScope`, `"town"` vs `"nj"`) feeds the
price/sqft, DOM-median, and comp-sales components. `scoreListingBothScopes()` computes both in one pass; `"nj"`
mode skips the town-specific cohort tiers entirely and starts at the NJ-wide type+bed tier. The price-cut component
is scope-independent (it's based on the listing's own history, not comps), so it's identical in both scores.

Each score is 0-100, a weighted blend of four 0-1 components (weights come from `ScoringConfig`, defaults in
parens):

1. **Price/sqft vs. comps** (`pricePerSqftWeight`, 0.4) — listing's `pricePerSqft` vs. the average for active
   listings in the same propertyType + bed-count bucket (buckets: 1, 2, 3, 4, "5+"), additionally scoped to town
   for the town score. Falls back to looser cohorts (town+type → NJ-wide type+beds → type-only → global) when the
   tight cohort has fewer than 3 comps, so small towns still get a sensible baseline instead of a missing signal.
2. **Price-cut magnitude + recency** (`priceCutWeight`, 0.3) — the most recent cut's `%` drop, scaled down linearly
   as it ages past `priceCutRecencyDays` (default 30d). A 10%+ cut at day 0 maxes out this component; anything
   older than the recency window contributes nothing.
3. **Days on market vs. median** (`domWeight`, 0.1) — town median for the town score, NJ-wide median for the NJ
   score. **Deliberately not** "old = bad deal" per the original spec. Freshness alone (at or below the median) is
   neutral either way. Only *staleness* (above median) moves this component, and the direction depends on price
   positioning: stale + already-underpriced reads as a possible motivated seller (reward), stale + overpriced reads
   as a possible underlying issue (penalize). This was a real bug caught during development — an earlier version
   penalized *fresh* well-priced listings symmetrically; see the `staleness = max(0, domRatio - 1)` guard in
   `scoreListing()`.
4. **Price vs. recent comp sales** (`compSalesWeight`, 0.2) — listing's `pricePerSqft` vs. the average sold
   `pricePerSqft` (soldPrice / sqft) among `SOLD` listings in the same cohort within `compSaleLookbackMonths`
   (default 12mo), same fallback-cohort logic as #1. Neutral (0.5) when there's no comp-sale data at all.

Each component is computed as "% better/worse than baseline," clipped to ±30%, and rescaled to 0-1 (0.5 = at
baseline). `scoreListing()` returns both the numeric score and a `reasons[]` array (label + human-readable detail +
point contribution) — the same result renders the inline `DealBadge` in the listings table (two columns, Town and
NJ) and the "why this score" breakdown on the Top Deals leaderboard, so there's exactly one scoring implementation
to keep in sync. The leaderboard's "Rank by" toggle (`/api/deals?rankBy=town|nj`) sorts by whichever score the user
picks; both scores are always included in the response regardless of ranking choice.

Weights are tunable from the Settings page (`src/app/settings/page.tsx` → `PUT /api/settings`) and take effect on
the very next request — nothing is cached or requires a restart. The same weights apply to both scopes.

## Filters

`src/lib/filters.ts` is the single source of truth for the `ListingFilters` shape, query-string parsing
(`parseListingFilters`), and the Prisma `where` clause builder (`buildListingWhere`) — used identically by
`/api/listings`, `/api/deals`, and the analytics endpoints, so "the currently filtered result set" means the same
thing everywhere the phrase applies (e.g. the price histogram). Sorting by `dealScoreTown`/`dealScoreNj` is a
special case (handled in `/api/listings/route.ts`) since neither is a DB column — the matching rows are pulled,
scored, sorted, and paginated in memory rather than in SQL. `/deals` uses the same `FilterPanel` component as the
main listings page (not a stripped-down subset) so any filter available on one is available on the other.

The filter panel is mobile-responsive: below `lg` it collapses behind a "☰ Filters" button (with an active-filter
count) that opens the panel as a full-screen drawer — that disclosure state lives inside `FilterPanel` itself, so
pages don't duplicate it.

## Adding a town

Add one entry to `TOWNS` in `src/lib/towns.ts` (name, county, nearest transit station) — the filter panel, mock
data generator, and town-comparison chart all read from that single list.

## Secondary analysis endpoints & UI

- `GET /api/analytics/summary` — headline stat cards (median price / $/sqft / DOM, active count, price-cut share)
  with month-over-month deltas computed from snapshots; rendered by `MarketSummaryCards` atop the Analytics page.
- `GET /api/deals/recent-cuts` — latest price cut per active listing, newest first; the "Just dropped" panel on
  Top Deals.
- `GET /api/listings/[id]/history` — one listing's snapshots + price-change events; powers
  `ListingHistoryModal` (step-line price chart, cut list, town-score breakdown), opened from the "📈" buttons on
  the table, grid, and leaderboard.
- `GET /api/listings/export` — CSV download of the currently filtered result set (2,000-row cap), linked from the
  "⬇ CSV" button on the listings page.
- Cosmetic: ACTIVE listings ≤7 days old get a green "NEW" chip; the listings page has a 25/50/100 page-size picker.

## External listing links

`src/lib/listingUrl.ts` → `getExternalListingUrl()` builds the "view listing ↗" link shown next to every address
(table, grid, and Top Deals leaderboard). It prefers `listing.url` when the provider set one (currently only
`CsvListingProvider`, since Redfin's CSV export carries a real listing URL per row) and otherwise falls back to a
Zillow address-search URL built from the listing's address/town/zip. That fallback is a *search*, not a guaranteed
direct hit — it only resolves to something meaningful when the address is real, which is why `DemoDataBanner`
(`src/components/DemoDataBanner.tsx`, shown whenever `SyncStatus.provider === "mock"`) exists: it's the honest
disclosure that the currently-active data is synthetic and these links won't go anywhere real yet.

## Deployment

Targets Vercel. `package.json` has a `vercel-build` script (`prisma generate && prisma db push --accept-data-loss
&& next build`) that Vercel automatically runs instead of `next build` — this applies the current schema to
`DATABASE_URL` on every deploy via `db push` rather than tracked migrations, which is fine for this app's low-risk,
mostly-additive schema changes but would need to switch to `prisma migrate deploy` + a migrations directory for a
stricter production process. `postinstall: prisma generate` covers local `npm install`. See the README's
"Deploying to Vercel" section for the exact click-through steps (Postgres provisioning, env vars, one-time seed).

Two route-classification bugs were caught and fixed during this work, both worth remembering if you add a new API
route: Next.js statically optimizes (and caches at *build* time) any route handler that doesn't read from the
request — `GET /api/settings` was accidentally static this way, which would have served build-time-frozen scoring
weights in production forever regardless of what was saved afterward. Any route reading mutable DB state needs
either a request-driven input (searchParams, etc. — most routes here have one already) or an explicit
`export const dynamic = "force-dynamic"` if it doesn't.

### Automatic daily sync (Vercel Cron)

`src/lib/runSync.ts` holds the one actual sync implementation (fetch → ingest → clear-mock-if-live → record
status), shared by three callers that differ only in auth: `POST /api/sync` (UI Refresh button — throttled, no
secret required since one can't live in client JS), a trusted `POST /api/sync` call with a matching
`x-sync-secret` header (manual/CLI use), and `GET /api/cron/sync` (`vercel.json`'s daily cron, `"0 9 * * *"` — the
max frequency Vercel's free Hobby plan allows). The cron route can't reuse the `x-sync-secret` check because
Vercel Cron always sends GET with no custom headers; instead it checks `Authorization: Bearer <CRON_SECRET>`,
which Vercel automatically attaches when a `CRON_SECRET` env var is set — the developer sets that env var once and
Vercel handles signing the request itself. All three paths call `getDefaultSyncQuery()`, so the cron job inherits
the same RentCast daily-county-rotation quota safety as everything else.

## Known mock-data quirks (expected, not bugs)

- DOM trend charts trend upward over the seeded window — that's individual mock listings aging within their own
  synthetic history, not a real market signal. Live-synced data won't show this artifact.
- The last month of any trend chart is a partial month (cut off at "now"), so inventory/DOM often dip or spike at
  the very last point.
