import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  findOne: vi.fn(),
  close: vi.fn(),
  Client: vi.fn(),
}));
vi.mock('mongoose', () => ({ default: { mongo: { MongoClient: mocks.Client } } }));
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/preview/product-evidence/route';
import { productEvidenceSummary } from '@/lib/preview-product-evidence';
import fixture from './fixtures/flipkart-product-real.json';
import { parseFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
const product =
  'https://www.flipkart.com/bla-bli-blu-old-money-perfume-men-apple-cedar-notes-perfume-men-long-lasting-30-ml/p/itmbe299cbfa6eb1?pid=PERHHHH3RYADXXH5';
const request = (authorization = 'Bearer test-only') =>
  new NextRequest(
    `https://preview.example/api/preview/product-evidence?url=${encodeURIComponent(product)}`,
    { headers: { authorization } },
  );
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('CRON_SECRET', 'test-only');
  vi.stubEnv('MONGODB_URI', 'offline-only');
  vi.resetAllMocks();
  mocks.Client.mockImplementation(() => ({
    connect: mocks.connect,
    db: () => ({ collection: () => ({ findOne: mocks.findOne }) }),
    close: mocks.close,
  }));
  mocks.close.mockResolvedValue(undefined);
  mocks.findOne.mockResolvedValue({
    title: 'PRIVATE_TITLE',
    users: ['PRIVATE_EMAIL'],
    canonicalIdentity: undefined,
    priceObservation: undefined,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('Preview-only single-record evidence inspection, offline', () => {
  it.each(['production', 'development', ''])(
    'refuses %s before DB access',
    async (value) => {
      vi.stubEnv('VERCEL_ENV', value);
      expect((await GET(request())).status).toBe(404);
      expect(mocks.Client).not.toHaveBeenCalled();
    },
  );
  it('requires configured bearer secret, with no query-string token access', async () => {
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
    expect(mocks.Client).not.toHaveBeenCalled();
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request())).status).toBe(503);
    expect(mocks.Client).not.toHaveBeenCalled();
  });
  it('does exactly one projected read and no write/scrape/background work', async () => {
    const r = await GET(request());
    expect(r.status).toBe(200);
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
    expect(mocks.findOne.mock.calls[0][0]).toEqual({ store: 'flipkart', url: product });
    expect(mocks.findOne.mock.calls[0][1].projection).toMatchObject({
      _id: 0,
      canonicalIdentity: 1,
      priceObservation: 1,
    });
    expect(mocks.findOne.mock.calls[0][1].projection).not.toHaveProperty('users');
    expect(mocks.Client.mock.calls[0][1]).toMatchObject({
      retryReads: false,
      retryWrites: false,
      maxPoolSize: 1,
    });
    const text = JSON.stringify(await r.json());
    expect(text).not.toMatch(/PRIVATE|offline-only|test-only|flipkart.com|PERHH/);
    expect(text).toContain('missing');
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it('rejects arbitrary URLs and multiple targets without DB access', async () => {
    for (const url of [
      'https://evil.example',
      'https://preview.example/api/preview/product-evidence?url=https://evil.example',
      `https://preview.example/api/preview/product-evidence?url=${encodeURIComponent(product)}&url=${encodeURIComponent(product)}`,
    ])
      expect(
        (
          await GET(
            new NextRequest(url, { headers: { authorization: 'Bearer test-only' } }),
          )
        ).status,
      ).toBe(400);
    expect(mocks.Client).not.toHaveBeenCalled();
  });
  it('redacts malformed connection configuration before client construction completes', async () => {
    mocks.Client.mockImplementationOnce(() => {
      throw new Error('PRIVATE_URI');
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE');
    expect(mocks.findOne).not.toHaveBeenCalled();
  });
  it('redacts database failures and closes the connection', async () => {
    mocks.connect.mockRejectedValue(new Error('PRIVATE_CONNECTION_CREDENTIALS'));
    const r = await GET(request());
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain('PRIVATE');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
  it('reports valid current-parser evidence safely, while missing volume remains a partial canonical object', () => {
    const url =
      'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-30-ml/p/itm25b0414fd539e?pid=PERHHD9GPW6NNYRQ';
    const parsed = parseFlipkartAPIProduct(JSON.stringify(fixture), url);
    expect(productEvidenceSummary(parsed)).toMatchObject({
      canonicalIdentity: {
        state: 'valid',
        independentlyValidated: true,
        selectedVolumePresent: true,
      },
      priceObservation: { present: true, boundAndFresh: true },
    });
    const p = structuredClone(fixture);
    Reflect.deleteProperty(p.product_results.specifications.General, 'Quantity');
    Reflect.deleteProperty(p.product_results.specifications.General, 'Net Quantity');
    Reflect.deleteProperty(p.product_results.specifications, 'Product Highlights');
    p.product_results.highlights = p.product_results.highlights.filter(
      (v) => !v.startsWith('Quantity:'),
    );
    const partial = parseFlipkartAPIProduct(JSON.stringify(p), url);
    expect(productEvidenceSummary(partial)).toMatchObject({
      canonicalIdentity: {
        state: 'valid',
        independentlyValidated: false,
        issues: ['volume-unconfirmed'],
      },
    });
    expect(partial.currentPrice).toBe(parsed.currentPrice);
  });
  it('distinguishes absent, null and invalid canonical evidence without exposing raw values', () => {
    expect(productEvidenceSummary(null)).toEqual({ found: false });
    for (const [value, state] of [
      [undefined, 'missing'],
      [null, 'null'],
      [{ private: 'SECRET' }, 'invalid'],
    ] as const) {
      const result = productEvidenceSummary({
        canonicalIdentity: value,
        priceObservation: null,
      });
      expect(result.canonicalIdentity?.state).toBe(state);
      expect(JSON.stringify(result)).not.toContain('SECRET');
    }
  });
});
