import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Offer } from '@/types';

const offer = (store: string, title: string, price: number): Offer => ({
  store,
  storeName: store === 'amazon' ? 'Amazon' : 'Flipkart',
  title,
  url: `https://${store}.example/${encodeURIComponent(title)}`,
  price,
  currency: '₹',
});

const pages: Record<string, Offer[] | Error> = {};

vi.mock('@/lib/scraper/load', () => ({
  loadAndParse: vi.fn(async (adapter: { id: string }) => {
    const result = pages[adapter.id];
    if (result instanceof Error) throw result;
    return result ?? [];
  }),
}));

// Flipkart search runs through its Affiliate API, which needs credentials.
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isFlipkartAffiliateConfigured: true,
}));

const { searchStores } = await import('@/lib/scraper/search');
const { findOffers } = await import('@/lib/scraper/compare');
const { findOffersWithDiagnostics } = await import('@/lib/scraper/compare');

describe('searchStores', () => {
  it('distinguishes missing Amazon candidates from rejected Flipkart identity offline', async () => {
    pages.amazon = [];
    pages.flipkart = [offer('flipkart', 'AL ADHEEM Blu C Chanel Perfume 100ml', 1499)];
    const result = await findOffersWithDiagnostics({
      title: 'BLA BLI BLU Love Drunk Perfume 100 ml Diagnostic',
      store: 'myntra.com',
      storeName: 'Myntra',
      url: 'https://www.myntra.com/x/36340100/buy',
      currentPrice: 650,
      currency: '₹',
      image: '',
    });
    expect(result.diagnostics).toEqual([
      {
        store: 'amazon',
        status: 'no-results',
        candidates: 0,
        verified: 0,
        reason: 'no-search-results',
        sourceEvidence: 'eligible',
        discovery: {
          cacheHit: false,
          parsedCandidates: 0,
          candidateLimit: 20,
          truncated: false,
        },
        rejections: {},
      },
      {
        store: 'flipkart',
        status: 'rejected',
        candidates: 1,
        verified: 0,
        reason: 'insufficient-identity',
        sourceEvidence: 'eligible',
        discovery: {
          cacheHit: false,
          parsedCandidates: 1,
          candidateLimit: 20,
          truncated: false,
        },
        rejections: { 'insufficient-identity': 1 },
      },
    ]);
    expect(result.offers.map((o) => o.store)).toEqual(['myntra.com']);
  });
  it('keeps Myntra at 650 and excludes the wrong Amazon result during comparison', async () => {
    pages.amazon = [
      offer(
        'amazon',
        'Blu C Chanel by AL ADHEEM Premium Long Lasting Perfume 100 ml',
        1499,
      ),
    ];
    pages.flipkart = [offer('flipkart', 'BLA BLI BLU Love Drunk Perfume 100ml', 700)];
    const results = await findOffers({
      title: 'BLA BLI BLU Love Drunk Long Lasting Perfume - 100 ml',
      store: 'myntra.com',
      storeName: 'Myntra',
      url: 'https://www.myntra.com/x/36340100/buy',
      currentPrice: 650,
      currency: '₹',
      image: '',
    });
    expect(results.map((o) => o.store)).toEqual(['myntra.com', 'flipkart']);
    expect(results[0].price).toBe(650);
  });
  it('excludes AL ADHEEM when discovering Love Drunk and keeps a genuine cross-store offer', async () => {
    pages.amazon = [
      offer(
        'amazon',
        'Blu C Chanel by AL ADHEEM Premium Long Lasting Perfume 100 ml',
        1499,
      ),
      offer('amazon', 'BLA BLI BLU Love Drunk Perfume 100ml', 700),
    ];
    pages.flipkart = [
      offer('flipkart', 'BLA BLI BLU Love Drunk Long Lasting Perfume 100 ml', 650),
    ];
    const { results } = await searchStores('BLA BLI BLU Love Drunk 100 ml', 'in');
    expect(results).toHaveLength(1);
    expect(results[0].offers).toHaveLength(2);
    expect(results[0].best.price).toBe(650);
    expect(results[0].offers.some((o) => o.title.includes('ADHEEM'))).toBe(false);
    const hit = await searchStores('BLA BLI BLU Love Drunk 100 ml', 'in');
    expect(hit.results[0].offers).toHaveLength(2);
  });
  beforeEach(() => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    for (const key of Object.keys(pages)) delete pages[key];
  });

  it('groups the same product across stores and picks the cheapest', async () => {
    pages.amazon = [
      offer(
        'amazon',
        'Logitech MX Master 3S Bluetooth Edition Wireless Mouse, Ultra-fast Scrolling',
        8495,
      ),
      offer('amazon', 'Silicone Case compatible with Logitech MX Master 3S', 499),
    ];
    pages.flipkart = [
      offer('flipkart', 'Logitech MX Master 3s Ergonomic Optical Mouse', 7995),
    ];

    const { results, failedStores } = await searchStores('logitech mx master 3s', 'in');
    expect(failedStores).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0].offers.map((o) => o.store)).toEqual(['flipkart', 'amazon']);
    expect(results[0].best.price).toBe(7995);
  });

  it('reports stores that fail and keeps the others', async () => {
    pages.amazon = [
      offer('amazon', 'JBL Flip 6 Wireless Portable Bluetooth Speaker', 8846),
    ];
    pages.flipkart = new Error('blocked');

    const { results, failedStores } = await searchStores('jbl flip 6', 'in');
    expect(failedStores).toEqual(['Flipkart']);
    expect(results[0].best.store).toBe('amazon');
  });

  it('only searches stores that serve the region', async () => {
    pages.amazon = [offer('amazon', 'Sony WH-1000XM5 Headphones', 348)];
    pages.flipkart = [offer('flipkart', 'Sony WH-1000XM5 Headphones', 300)];

    const { results } = await searchStores('sony wh-1000xm5', 'us');
    expect(results.flatMap((r) => r.offers.map((o) => o.store))).toEqual(['amazon']);
  });
});
