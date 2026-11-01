import { describe, it, expect, vi } from 'vitest';
import { dedicatedFirst } from '@/lib/scraper/provider-routes';
import { ScrapeError } from '@/lib/scraper/errors';
describe('dedicated-first explicit fallback budget', () => {
  it('does not silently fall back by default', async () => {
    const fallback = { paid: true, run: vi.fn().mockResolvedValue([2]) };
    await expect(
      dedicatedFirst(
        {
          paid: true,
          run: async () => {
            throw new ScrapeError('busy', 'rate-limited');
          },
        },
        fallback,
      ),
    ).rejects.toThrow('busy');
    expect(fallback.run).not.toHaveBeenCalled();
  });
  it('supports explicit fallback on empty results with a two-request budget', async () => {
    const fallback = { paid: true, run: vi.fn().mockResolvedValue([2]) };
    expect(
      await dedicatedFirst({ paid: true, run: async () => [] }, fallback, {
        allowFallback: true,
        maxPaidRequests: 2,
      }),
    ).toEqual([2]);
    expect(fallback.run).toHaveBeenCalledTimes(1);
  });
  it('blocks a second paid route when only one was budgeted', async () => {
    const fallback = { paid: true, run: vi.fn() };
    await expect(
      dedicatedFirst({ paid: true, run: async () => [] }, fallback, {
        allowFallback: true,
        maxPaidRequests: 1,
      }),
    ).rejects.toThrow(/budget/);
    expect(fallback.run).not.toHaveBeenCalled();
  });
  it('preserves failures if an approved fallback also finds nothing', async () => {
    await expect(
      dedicatedFirst(
        {
          paid: true,
          run: async () => {
            throw new ScrapeError('busy', 'unavailable');
          },
        },
        { paid: false, run: async () => [] },
        { allowFallback: true, maxPaidRequests: 1 },
      ),
    ).rejects.toThrow('busy');
  });
  it('never falls back after security/identity parse rejection', async () => {
    const fallback = { paid: false, run: vi.fn() };
    await expect(
      dedicatedFirst(
        {
          paid: true,
          run: async () => {
            throw new ScrapeError('wrong identity', 'parse');
          },
        },
        fallback,
        { allowFallback: true, maxPaidRequests: 2 },
      ),
    ).rejects.toThrow('wrong identity');
    expect(fallback.run).not.toHaveBeenCalled();
  });
});
