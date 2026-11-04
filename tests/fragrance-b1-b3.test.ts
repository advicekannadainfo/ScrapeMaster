import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withFragranceProduct } from './support/fragrance-product';
import { verifiedOffers } from '@/lib/verified-offers';
import { retainOfferEvidence, mergeVerifiedCandidateOffers } from '@/lib/services/offers';

const root = (store = 'amazon', price = 200) => ({
  title: 'Acme Quiet Garden Perfume 30ml',
  brand: 'Acme',
  variant: '30ml',
  store,
  storeName: store,
  url:
    store === 'amazon'
      ? 'https://www.amazon.in/dp/B0TEST0001'
      : 'https://www.flipkart.com/acme/p/itmtest',
  currency: '₹',
  currentPrice: price,
  price,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());
describe('B1 independent Product proof and B3 per-offer observation (synthetic, offline)', () => {
  it('hides title/listing-only prices even if a legacy flag says verified', () => {
    const source = withFragranceProduct(root());
    const listing = { ...root('flipkart'), comparisonIdentityVerified: true };
    expect(verifiedOffers(source, [listing])).toEqual([]);
    expect(
      verifiedOffers({ ...root(), comparisonIdentityVerified: true }, [
        withFragranceProduct(listing),
      ]),
    ).toEqual([]);
  });
  it('shows fresh independently verified manual Product offers without a saved flag', () => {
    const a = withFragranceProduct(root()),
      b = withFragranceProduct(root('flipkart'));
    expect(verifiedOffers(a, [b])).toEqual([b]);
    expect(
      mergeVerifiedCandidateOffers({ ...a, offers: [b] }, []).some(
        (o) => o.store === 'flipkart',
      ),
    ).toBe(true);
  });
  it('expires manual prices after ten minutes without deleting their identity evidence', () => {
    const a = withFragranceProduct(root()),
      b = withFragranceProduct(root('flipkart'));
    const before = JSON.stringify(b);
    vi.advanceTimersByTime(600001);
    const visible = mergeVerifiedCandidateOffers({ ...a, offers: [b] }, []);
    expect(visible.map((o) => o.store)).toEqual(['amazon']);
    const stored = retainOfferEvidence([b], visible);
    expect(stored.find((o) => o.store === 'flipkart')).toBe(b);
    expect(JSON.stringify(b)).toBe(before);
    expect(verifiedOffers(a, stored).map((o) => o.store)).toEqual(['amazon']);
  });
  it('never manufactures observations from Compare/manual check timestamps', () => {
    const a = withFragranceProduct(root()),
      b = withFragranceProduct(root('flipkart'));
    const unobserved = { ...b, priceObservation: null };
    const checked = {
      ...a,
      offersCheckedAt: new Date(),
      candidateLinksCheckedAt: new Date(),
    };
    expect(verifiedOffers(checked, [unobserved])).toEqual([]);
    expect(retainOfferEvidence([unobserved], []).at(0)?.priceObservation).toBeNull();
  });
  it.each(['stock', 'price', 'url', 'future', 'missing'])(
    'hides %s observation evidence while retaining valid own tracking',
    (kind) => {
      const a = withFragranceProduct(root()),
        b = withFragranceProduct(root('flipkart'));
      const o = { ...b.priceObservation! };
      if (kind === 'stock') o.inStock = false;
      if (kind === 'price') o.price = 201;
      if (kind === 'url') o.url = a.url;
      if (kind === 'future') o.observedAt = '2026-11-04T11:00:00Z';
      expect(
        verifiedOffers(a, [
          { ...b, priceObservation: kind === 'missing' ? undefined : o },
        ]),
      ).toEqual([]);
      expect(verifiedOffers(a, [a])).toHaveLength(1);
    },
  );
  it('replaces only the newly verified store observation; keeps other stored evidence', () => {
    const old = withFragranceProduct(root('flipkart'));
    const fresh = withFragranceProduct(root('flipkart', 180));
    const other = {
      ...root('myntra.com'),
      url: 'https://www.myntra.com/perfume/12345678/buy',
    };
    const retained = retainOfferEvidence([old, other], [fresh]);
    expect(retained.find((o) => o.store === 'flipkart')).toBe(fresh);
    expect(retained.find((o) => o.store === 'myntra.com')).toBe(other);
  });
});
