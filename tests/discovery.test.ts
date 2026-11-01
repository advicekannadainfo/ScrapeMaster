import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer } from '@/types';
import type { StoreAdapter } from '@/lib/scraper/stores/types';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/scraper/load', () => ({ loadAndParse: mocks.load }));
let discover: typeof import('@/lib/scraper/discovery').discoverOffers;
const sample: Offer = {
  store: 'amazon',
  storeName: 'Amazon',
  title: 'BLA BLI BLU Love Drunk 100ml',
  price: 700,
  currency: '₹',
  url: 'https://www.amazon.in/dp/B012345678',
};
const adapter: StoreAdapter = {
  id: 'amazon',
  name: 'Amazon',
  matches: () => true,
  normalize: String,
  parse: vi.fn(),
  search: {
    regions: ['in'],
    url: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}`,
    parse: () => [sample],
  },
};
beforeEach(async () => {
  vi.resetModules();
  mocks.load.mockReset();
  mocks.load.mockResolvedValue([sample]);
  discover = (await import('@/lib/scraper/discovery')).discoverOffers;
});
afterEach(() => vi.useRealTimers());
describe('shared discovery credit controls', () => {
  it('coalesces concurrent requests and reuses candidates between comparison/name search', async () => {
    const [a, b] = await Promise.all([
      discover(adapter, 'love drunk', 'in'),
      discover(adapter, 'love drunk', 'in'),
    ]);
    expect(a).toEqual(b);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    a.pop();
    expect(await discover(adapter, 'love drunk', 'in')).toHaveLength(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('caches empty results rather than repeatedly charging for absent products', async () => {
    mocks.load.mockResolvedValue([]);
    await discover(adapter, 'empty', 'in');
    await discover(adapter, 'empty', 'in');
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('enforces a failure cooldown with no immediate retry', async () => {
    vi.useFakeTimers();
    mocks.load.mockRejectedValue(new Error('blocked'));
    await expect(discover(adapter, 'failed', 'in')).rejects.toThrow();
    await expect(discover(adapter, 'failed', 'in')).rejects.toThrow();
    expect(mocks.load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    mocks.load.mockResolvedValue([sample]);
    expect(await discover(adapter, 'failed', 'in')).toHaveLength(1);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('does not call disabled or region-incompatible stores', async () => {
    expect(
      await discover(
        { ...adapter, search: { ...adapter.search!, enabled: () => false } },
        'disabled',
        'in',
      ),
    ).toEqual([]);
    expect(await discover(adapter, 'disabled', 'us')).toEqual([]);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
