import { z } from 'zod';
import {
  readCanonicalIdentity,
  independentFragrance,
  fragranceIdentity,
  fragranceProfile,
  type FragranceInput,
} from './fragrance';
import type { CanonicalIdentity } from './contracts';
export const PRICE_TTL_MS = 10 * 60_000;
const observation = z.object({
  version: z.literal(1),
  store: z.string().max(20),
  url: z.string().url(),
  identityKey: z.string().max(1000),
  observedAt: z.string().datetime(),
  price: z.number().finite().positive(),
  currency: z.literal('₹'),
  inStock: z.boolean(),
});
export type PriceObservation = z.infer<typeof observation>;
export const identityKey = (e: CanonicalIdentity) =>
  JSON.stringify([
    e.profile,
    e.brand.value,
    e.line?.value,
    ...['volume', 'pack', 'concentration', 'formulation', 'edition'].map(
      (k) => e.selected[k as keyof typeof e.selected]?.value ?? null,
    ),
    e.negated,
    e.issues,
    // Preserve old observation keys byte-for-byte when the new proof is absent.
    ...(e.selected.packageGtin ? ['package-gtin', e.selected.packageGtin.value] : []),
  ]);
export function observeProduct(
  identity: unknown,
  price: number,
  currency: string,
  isOutOfStock: boolean,
) {
  if (typeof isOutOfStock !== 'boolean') return null;
  const e = readCanonicalIdentity(identity);
  if (!e || e.source.kind !== 'product') return null;
  const result = observation.safeParse({
    version: 1,
    store: e.source.store,
    url: e.source.url,
    identityKey: identityKey(e),
    observedAt: new Date().toISOString(),
    price,
    currency,
    inStock: !isOutOfStock,
  });
  return result.success ? result.data : null;
}
/** Check an existing Product observation before any offer display, even when it
 * is not tagged savedTrackedProduct. Absence stays unrecorded (legacy policy),
 * never proof of stock, price freshness or independently selected identity. */
export function profileOfferObservationStatus(record: {
  canonicalIdentity?: unknown;
  priceObservation?: unknown;
  store: string;
  url: string;
  price: number;
  currency: string;
}) {
  const e = readCanonicalIdentity(record.canonicalIdentity);
  if (e?.source.kind !== 'product' || record.priceObservation == null)
    return 'unrecorded' as const;
  const parsed = observation.safeParse(record.priceObservation);
  if (!parsed.success) return 'invalid' as const;
  const p = parsed.data;
  if (
    p.url !== record.url ||
    e.source.url !== record.url ||
    p.store !== record.store ||
    e.source.store !== record.store ||
    p.identityKey !== identityKey(e) ||
    p.price !== record.price ||
    p.currency !== record.currency ||
    Date.parse(p.observedAt) > Date.now()
  )
    return 'invalid' as const;
  return p.inStock ? ('consistent' as const) : ('out-of-stock' as const);
}
export function freshProfilePrice(
  record: {
    title?: string;
    brand?: string;
    variant?: string;
    canonicalIdentity?: unknown;
    priceObservation?: unknown;
    url: string;
    store: string;
    currentPrice: number;
    currency: string;
    isOutOfStock?: boolean;
  },
  now = Date.now(),
) {
  const e = readCanonicalIdentity(record.canonicalIdentity),
    o = observation.safeParse(record.priceObservation);
  if (
    !e ||
    !independentFragrance(e) ||
    !o.success ||
    !record.title ||
    !fragranceIdentity({ ...record, title: record.title })
  )
    return false;
  const p = o.data,
    age = now - Date.parse(p.observedAt);
  return (
    age >= 0 &&
    age <= PRICE_TTL_MS &&
    p.store === record.store &&
    p.url === record.url &&
    e.source.url === record.url &&
    e.source.store === record.store &&
    p.identityKey === identityKey(e) &&
    p.price === record.currentPrice &&
    p.currency === record.currency &&
    p.inStock &&
    record.isOutOfStock === false
  );
}
export type ProductAssociation = {
  profile: 'fragrance-v1';
  store: string;
  url: string;
  identity: CanonicalIdentity;
};
/** Persistent identity only, never a cached price and never proof by URL alone. */
export function validAssociations(
  source: FragranceInput,
  links: unknown,
): ProductAssociation[] {
  const a = fragranceIdentity(source);
  if (!a || !independentFragrance(source.canonicalIdentity) || !Array.isArray(links))
    return [];
  return links.slice(0, 40).flatMap((link) => {
    if (!link || typeof link !== 'object') return [];
    const e = readCanonicalIdentity(link.identity);
    if (
      !e ||
      !independentFragrance(e) ||
      link.profile !== 'fragrance-v1' ||
      link.url !== e.source.url ||
      link.store !== e.source.store ||
      e.source.url === source.url ||
      e.source.store === source.store ||
      fragranceProfile.compare(a, e).status !== 'verified'
    )
      return [];
    return [
      {
        profile: 'fragrance-v1' as const,
        store: e.source.store,
        url: e.source.url,
        identity: e,
      },
    ];
  });
}
