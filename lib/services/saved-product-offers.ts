import 'server-only';
import ProductModel from '@/lib/models/product.model';
import type { Offer } from '@/types';
import {
  exactMatch,
  freshSavedPrice,
  sufficientExactEvidence,
  SAVED_PRODUCT_TTL_MS,
} from '@/lib/scraper/exact-evidence';
type Source = {
  store: string;
  url: string;
  currentPrice: number;
  currency: string;
  isOutOfStock?: boolean;
  exactEvidence?: unknown;
};
export async function savedProductOffers(source: Source): Promise<Offer[]> {
  const sourceGate = !sufficientExactEvidence(source.exactEvidence)
    ? 'source-evidence-insufficient'
    : !freshSavedPrice(source)
      ? 'source-price-unavailable-or-stale'
      : undefined;
  if (sourceGate) {
    console.info('[compare] Saved product reuse', {
      status: sourceGate,
      candidates: 0,
      verified: 0,
    });
    return [];
  }
  const records = await ProductModel.find({
    store: { $ne: source.store },
    currency: source.currency,
    isOutOfStock: false,
    'exactEvidence.observedAt': {
      $gte: new Date(Date.now() - SAVED_PRODUCT_TTL_MS).toISOString(),
    },
  })
    .select(
      'store storeName title url currentPrice currency image isOutOfStock exactEvidence brand variant',
    )
    .sort({ 'exactEvidence.observedAt': -1 })
    .limit(40)
    .lean();
  const byStore = new Map<string, Offer>();
  for (const record of records) {
    if (
      record.store === source.store ||
      record.url === source.url ||
      !freshSavedPrice(record) ||
      exactMatch(source.exactEvidence, record.exactEvidence) !== 'verified'
    )
      continue;
    if (!byStore.has(record.store))
      byStore.set(record.store, {
        store: record.store,
        storeName: record.storeName,
        title: record.title,
        url: record.url,
        price: record.currentPrice,
        currency: record.currency,
        image: record.image ?? undefined,
        brand: record.brand ?? undefined,
        variant: record.variant ?? undefined,
        exactEvidence: record.exactEvidence,
        savedTrackedProduct: true,
      });
  }
  console.info('[compare] Saved product reuse', {
    status: byStore.size ? 'verified-competitor' : 'no-fresh-exact-match',
    candidates: records.length,
    verified: byStore.size,
  });
  return [...byStore.values()];
}
