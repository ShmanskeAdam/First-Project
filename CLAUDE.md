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
  Set `LISTING_PROVIDER=rentcast` and `RENTCAST_API_KEY` in `.env`. Calls `GET /listings/sale` per town (RentCast
  has no county/bounding-box query), so `fetchListings` requires an explicit `towns` list — the sync script passes
  `TOWN_NAMES` from `src/lib/towns.ts`.
- **`CsvListingProvider`** (`csvProvider.ts`) — parses a Redfin "Download All" CSV export (a feature Redfin
  explicitly permits) into `RawListing[]`. Not wired into `getActiveProvider()` by default since it takes a CSV
  string rather than reading env config; use it directly in a one-off script if you want to bulk-import a Redfin
  export, e.g.:
  ```ts
  const csv = fs.readFileSync("redfin_export.csv", "utf8");
  const provider = new CsvListingProvider(csv);
  await ingestRawListings(await provider.fetchListings(), provider.key);
  ```

`src/lib/providers/index.ts` → `getActiveProvider()` picks the provider from `LISTING_PROVIDER` (defaults to
`"mock"`). **Do not build a Zillow scraper** — Zillow's ToS prohibits it. RentCast/RapidAPI resellers, ATTOM, and
Redfin's CSV export are the sanctioned paths; see the README for how to add another RapidAPI-based provider (same
pattern as `rentcastProvider.ts`).

### Ingestion pipeline

`src/lib/ingest.ts` → `ingestRawListing(raw, source)` is the single place that turns a `RawListing` into DB rows:
upserts the `Listing` (keyed on `[source, externalId]`), recomputes `pricePerSqft`/`daysOnMarket`, writes a
`PriceChange` row if the price moved since last sync, and always appends one `ListingSnapshot` row. `scripts/sync-listings.ts`
is the cron entrypoint (`npm run sync`); `POST /api/sync` exposes the same thing over HTTP.

Every sync (cron, `npm run sync`, or a manual click) also calls `recordSyncStatus()` (`src/lib/syncStatus.ts`),
which upserts the single-row `SyncStatus` table — this is what powers the "Last refreshed: Xm ago" indicator in the
nav bar. `GET /api/sync` reads it (no auth, no side effects); `POST /api/sync` triggers a real sync. Unlike the
CLI/cron path, the public UI's Refresh button can't carry `SYNC_SECRET` (it would have to ship in client-side JS),
so `POST /api/sync` treats a request with a **valid** `x-sync-secret` header as trusted and skips the throttle, and
rate-limits everything else to one sync per 30 seconds (`MIN_MANUAL_INTERVAL_MS` in `src/app/api/sync/route.ts`) —
that throttle, not a secret, is what actually protects a live provider from being hammered by site visitors.
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
  `fetched`, `ingested`), written by every sync path and read by the nav bar's "Last refreshed" indicator.

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

## Adding a town

Add one entry to `TOWNS` in `src/lib/towns.ts` (name, county, nearest transit station) — the filter panel, mock
data generator, and town-comparison chart all read from that single list.

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

## Known mock-data quirks (expected, not bugs)

- DOM trend charts trend upward over the seeded window — that's individual mock listings aging within their own
  synthetic history, not a real market signal. Live-synced data won't show this artifact.
- The last month of any trend chart is a partial month (cut off at "now"), so inventory/DOM often dip or spike at
  the very last point.
