import { comparisonPriceStatus } from '@/lib/scraper/match';
import 'server-only';
import ProductModel from '@/lib/models/product.model';
import type { Offer } from '@/types';
import {
  independentFragrance,
  fragranceIdentity,
  readCanonicalIdentity,
} from '@/lib/scraper/matching/fragrance';
import {
  freshProfilePrice,
  validAssociations,
  type ProductAssociation,
} from '@/lib/scraper/matching/observations';
import { isVerifiedProductMatch } from '@/lib/verified-offers';
export type TrackedSource = {
  title: string;
  brand?: string | null;
  variant?: string | null;
  comparisonIdentityVerified?: boolean | null;
  store: string;
  url: string;
  currentPrice: number;
  currency: string;
  isOutOfStock?: boolean;
  canonicalIdentity?: unknown;
  priceObservation?: unknown;
  productLinks?: unknown;
};
export async function fragranceProductLinks(source: TrackedSource) {
  const input = {
    ...source,
    brand: source.brand ?? undefined,
    variant: source.variant ?? undefined,
    comparisonIdentityVerified: source.comparisonIdentityVerified ?? undefined,
  };
  const identity = fragranceIdentity(input);
  if (!identity || !independentFragrance(source.canonicalIdentity))
    return { offers: [] as Offer[], links: [] as ProductAssociation[] };
  const prior = validAssociations(input, source.productLinks);
  // Identity lookup deliberately includes stale observations. No network transport.
  const records = await ProductModel.find({
    store: { $ne: source.store },
    $or: [
      {
        'canonicalIdentity.profile': 'fragrance-v1',
        'canonicalIdentity.brand.value': identity.brand.value,
        'canonicalIdentity.line.value': identity.line!.value,
      },
      ...(prior.length ? [{ url: { $in: prior.map((p) => p.url) } }] : []),
    ],
  })
    .select(
      'title brand variant store storeName url currentPrice currency image isOutOfStock canonicalIdentity priceObservation comparisonIdentityVerified',
    )
    .sort({ 'priceObservation.observedAt': -1 })
    .limit(40)
    .lean();
  const links = new Map(prior.map((p) => [p.url, p]));
  const offers = new Map<string, Offer>();
  let priceAnomalies = 0;
  for (const record of records) {
    const candidate = {
      ...record,
      brand: record.brand ?? undefined,
      variant: record.variant ?? undefined,
      comparisonIdentityVerified: record.comparisonIdentityVerified ?? undefined,
    };
    const e = readCanonicalIdentity(record.canonicalIdentity);
    if (
      record.store === source.store ||
      record.url === source.url ||
      !e ||
      !independentFragrance(e) ||
      !isVerifiedProductMatch(input, candidate)
    ) {
      links.delete(record.url);
      continue;
    }
    links.set(record.url, {
      profile: 'fragrance-v1',
      store: record.store,
      url: record.url,
      identity: e,
    });
    if (
      !freshProfilePrice(input) ||
      !freshProfilePrice(candidate) ||
      offers.has(record.store)
    )
      continue;
    if (comparisonPriceStatus(record.currentPrice, source.currentPrice) !== 'accepted') {
      priceAnomalies++;
      continue;
    }
    offers.set(record.store, {
      store: record.store,
      storeName: record.storeName,
      title: record.title,
      url: record.url,
      price: record.currentPrice,
      currency: record.currency,
      brand: record.brand ?? undefined,
      variant: record.variant ?? undefined,
      image: record.image ?? undefined,
      canonicalIdentity: e,
      priceObservation: record.priceObservation,
      savedTrackedProduct: true,
    });
  }
  console.info('[compare] Fragrance association', {
    candidates: records.length,
    linked: Math.min(links.size, 40),
    freshOffers: offers.size,
    priceAnomalies,
  });
  return { links: [...links.values()].slice(0, 40), offers: [...offers.values()] };
}
