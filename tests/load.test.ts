import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrapeError } from '@/lib/scraper/errors';

const fetchHtml = vi.fn();
const renderHtml = vi.fn();
const browser = { configured: true };

vi.mock('@/lib/scraper/http', () => ({
  fetchHtml,
  assertPublicURL: vi.fn(),
  fetchMyntraProductJSON: vi.fn(),
  fetchMyntraSearchJSON: vi.fn(),
  myntraProductID: vi.fn(),
}));
vi.mock('@/lib/scraper/browser', () => ({
  renderHtml,
  get isBrowserConfigured() {
    return browser.configured;
  },
}));

const { loadAndParse, loadRetry } = await import('@/lib/scraper/load');
const { HealthRegistry, getHealthRegistry, setHealthRegistry, CircuitOpenError } =
  await import('@/lib/scraper/health');
loadRetry.baseDelayMs = 1;
loadRetry.maxDelayMs = 2;
const httpStore = {
  id: 'amazon',
  name: 'Amazon',
  matches: () => true,
  normalize: String,
  parse: vi.fn(),
};
const browserStore = { ...httpStore, id: 'flipkart', fetchMode: 'browser' as const };
const parse = (html: string) => {
  if (html.includes('captcha')) throw new ScrapeError('captcha');
  return html;
};

describe('loadAndParse', () => {
  it('also avoids automatic paid retries for generic product rendering', async () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    fetchHtml.mockRejectedValue(new ScrapeError('busy', 'rate-limited'));
    await expect(
      loadAndParse(httpStore, 'https://www.amazon.in/dp/B012345678', parse),
    ).rejects.toThrow('busy');
    expect(fetchHtml).toHaveBeenCalledTimes(1);
  });
  it('never retries a paid general-scraper search', async () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
    fetchHtml.mockRejectedValue(new ScrapeError('busy', 'rate-limited'));
    await expect(
      loadAndParse(httpStore, 'https://www.amazon.in/s?k=perfume', parse, {
        kind: 'search',
      }),
    ).rejects.toThrow('busy');
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(renderHtml).not.toHaveBeenCalled();
  });
  it('keeps an optional dedicated search transport separate with no retries', async () => {
    const load = vi.fn().mockRejectedValue(new ScrapeError('busy', 'rate-limited'));
    const store = {
      ...httpStore,
      search: {
        regions: ['in' as const],
        url: () => 'https://example.com/search',
        parse: () => [],
        load,
      },
    };
    await expect(
      loadAndParse(store, 'https://example.com/search', parse, { kind: 'search' }),
    ).rejects.toThrow('busy');
    expect(load).toHaveBeenCalledTimes(1);
    expect(fetchHtml).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Keep offline test cases independent of the cloud's real secret binding.
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    browser.configured = true;
    setHealthRegistry(new HealthRegistry());
  });

  it('uses plain HTTP when it parses', async () => {
    fetchHtml.mockResolvedValue('<ok>');
    await expect(loadAndParse(httpStore, 'https://s.example', parse)).resolves.toBe(
      '<ok>',
    );
    expect(renderHtml).not.toHaveBeenCalled();
  });

  it('falls back to the browser when HTTP returns a bot check', async () => {
    fetchHtml.mockResolvedValue('captcha');
    renderHtml.mockResolvedValue('<rendered>');
    await expect(loadAndParse(httpStore, 'https://s.example', parse)).resolves.toBe(
      '<rendered>',
    );
  });

  it('does not fall back when no browser is configured', async () => {
    browser.configured = false;
    fetchHtml.mockResolvedValue('captcha');
    await expect(loadAndParse(httpStore, 'https://s.example', parse)).rejects.toThrow(
      'captcha',
    );
  });

  it('always renders browser-only stores', async () => {
    renderHtml.mockResolvedValue('<rendered>');
    await expect(loadAndParse(browserStore, 'https://s.example', parse)).resolves.toBe(
      '<rendered>',
    );
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('routes browser-only stores through ScrapingDog when configured', async () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', 'test-key');
    fetchHtml.mockResolvedValue('<provider-rendered>');
    await expect(
      loadAndParse(browserStore, 'https://www.flipkart.com/x/p/1', parse),
    ).resolves.toBe('<provider-rendered>');
    expect(renderHtml).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('retries transient failures and records one success', async () => {
    browser.configured = false;
    fetchHtml
      .mockRejectedValueOnce(new ScrapeError('busy', 'rate-limited'))
      .mockResolvedValue('<ok>');
    await expect(
      loadAndParse(httpStore, 'https://www.amazon.in/s?k=jbl', parse),
    ).resolves.toBe('<ok>');
    expect(fetchHtml).toHaveBeenCalledTimes(2);
    const [entry] = getHealthRegistry().all();
    expect(entry).toMatchObject({
      source: 'amazon:search',
      storeName: 'Amazon',
      recent: [true],
    });
    expect(getHealthRegistry().runStats().get('amazon:search')?.retries).toBe(1);
  });

  it('does not retry permanent failures', async () => {
    fetchHtml.mockRejectedValue(new ScrapeError('gone', 'not-found'));
    await expect(
      loadAndParse(httpStore, 'https://www.amazon.in/dp/X', parse),
    ).rejects.toThrow('gone');
    expect(fetchHtml).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after repeated failures and then skips the source', async () => {
    browser.configured = false;
    fetchHtml.mockRejectedValue(new ScrapeError('captcha', 'blocked'));
    for (let i = 0; i < 3; i++) {
      await expect(
        loadAndParse(httpStore, 'https://www.amazon.in/dp/X', parse),
      ).rejects.toThrow();
    }
    const calls = fetchHtml.mock.calls.length;
    await expect(
      loadAndParse(httpStore, 'https://www.amazon.in/dp/Y', parse),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetchHtml).toHaveBeenCalledTimes(calls);
    // Other page kinds of the same store are unaffected.
    fetchHtml.mockResolvedValue('<ok>');
    await expect(
      loadAndParse(httpStore, 'https://www.amazon.in/gp/bestsellers/', parse),
    ).resolves.toBe('<ok>');
  });
});
