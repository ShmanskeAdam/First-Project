import type { Listing } from "@/types/listing";

/**
 * External link for "click into the exact listing." Prefers the provider's
 * own URL when one exists (Redfin CSV imports carry a real listing URL;
 * RentCast does not expose one, so this is always the fallback there too).
 * Otherwise builds a Zillow address-search URL — this is a *search*, not a
 * guaranteed direct hit, so it's only meaningful when the address is real.
 * Mock/demo data has synthetic addresses that generally won't resolve to an
 * actual Zillow listing; see the "demo data" banner shown alongside it.
 */
export function getExternalListingUrl(listing: Pick<Listing, "url" | "address" | "town" | "zip">): string {
  if (listing.url) return listing.url;
  const query = `${listing.address}, ${listing.town}, NJ ${listing.zip}`;
  const slug = query
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://www.zillow.com/homes/${slug}_rb/`;
}
