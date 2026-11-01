import 'server-only';
import { retry, type RetryOptions } from '@/lib/utils/retry';
import { isBrowserConfigured, renderHtml } from './browser';
import { isTransient, ScrapeError } from './errors';
import { getHealthRegistry, pageKind } from './health';
import { assertPublicURL, fetchHtml } from './http';
import { adapters } from './stores';
import { storeFromHost } from './stores/generic';
import type { StoreAdapter } from './stores/types';

type LoadOptions = Parameters<typeof renderHtml>[1] & {
  /** Fetch over plain HTTP with these headers (official APIs). */
  headers?: Record<string, string>;
};

/** Retry policy for store requests; tests shorten the delays. */
export const loadRetry: RetryOptions = {
  attempts: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 20_000,
};

function sourceFor(adapter: StoreAdapter, url: string) {
  // Attribute to the dedicated store when one matches (e.g. a homepage check
  // via the generic adapter still counts as Amazon), else to the domain.
  const parsed = new URL(url);
  const dedicated =
    adapter.id === 'generic' ? adapters.find((a) => a.matches(parsed)) : adapter;
  const store = dedicated
    ? { id: dedicated.id, name: dedicated.name }
    : storeFromHost(parsed.hostname);
  const kind = pageKind(url);
  return { source: `${store.id}:${kind}`, store: store.id, storeName: store.name, kind };
}

async function attempt<T>(
  adapter: StoreAdapter,
  url: string,
  parse: (html: string) => T,
  { headers, ...render }: LoadOptions = {},
) {
  if (adapter.productAPI?.matches(new URL(url))) {
    return parse(await adapter.productAPI.load(url));
  }
  if (headers) return parse(await fetchHtml(url, headers));
  // ScrapingDog renders browser-only stores too; do not bypass it for Flipkart.
  if (process.env.SCRAPINGDOG_API_KEY) return parse(await fetchHtml(url));
  if (adapter.fetchMode === 'browser') {
    await assertPublicURL(url);
    return parse(await renderHtml(url, render));
  }
  try {
    return parse(await fetchHtml(url));
  } catch (error) {
    // HTTP-first stores fall back to a real browser when the response can't
    // be parsed (typically a bot check), if one is configured.
    if (!(error instanceof ScrapeError) || !isTransient(error) || !isBrowserConfigured)
      throw error;
    return parse(await renderHtml(url, render));
  }
}

/**
 * Load a store page and parse it. Skips sources whose circuit is open,
 * retries transient failures with jittered backoff, and records the outcome
 * in the health registry.
 */
export async function loadAndParse<T>(
  adapter: StoreAdapter,
  url: string,
  parse: (html: string) => T,
  options?: LoadOptions,
) {
  const health = getHealthRegistry();
  const ref = sourceFor(adapter, url);
  health.assertCanAttempt(ref.source);

  const productAPI = adapter.productAPI?.matches(new URL(url))
    ? adapter.productAPI
    : undefined;

  try {
    const result = await retry(() => attempt(adapter, url, parse, options), {
      ...loadRetry,
      ...(productAPI ? { attempts: 1 } : {}),
      shouldRetry: isTransient,
      onRetry: () => health.retried(ref.source),
    });
    health.record(ref, true);
    return result;
  } catch (error) {
    health.record(ref, false, error);
    throw error;
  }
}
