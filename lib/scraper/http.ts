import 'server-only';
import {
  reservePreviewProviderRequest,
  denyPreviewGenericRequest,
} from './preview-provider-budget';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import axios, { type AxiosRequestConfig } from 'axios';
import { USER_AGENT } from './agent';
import { kindForStatus, ScrapeError } from './errors';
import { assertRobotsAllowed } from './robots';
import { throttle } from './throttle';

export { ScrapeError };
import { amazonIndiaProductInput, flipkartProductInput } from './retail-product-input';

/** Prepared transports only: adapters stay on verified HTML until JSON contracts exist. */
export async function fetchAmazonProductJSON(input: string): Promise<string> {
  const target = amazonIndiaProductInput(input);
  return dedicatedProductRequest(
    'amazon',
    { asin: target.asin, domain: 'in', country: 'in' },
    target.url,
  );
}

export async function fetchFlipkartProductJSON(input: string): Promise<string> {
  const target = flipkartProductInput(input);
  return dedicatedProductRequest('flipkart', { url: target.url }, target.url);
}

async function dedicatedProductRequest(
  store: 'amazon' | 'flipkart',
  params: Record<string, string>,
  target: string,
): Promise<string> {
  const key = process.env.SCRAPINGDOG_API_KEY;
  if (!key) throw new ScrapeError('ScrapingDog API key is missing.', 'unsupported');
  await assertPublicURL(target);
  await throttle(target);
  reservePreviewProviderRequest(store, 'product');
  try {
    const response = await axios.get(`https://api.scrapingdog.com/${store}/product`, {
      params: { api_key: key, ...params },
      timeout: 60_000,
      maxRedirects: 0,
      maxContentLength: 10 * 1024 * 1024,
      responseType: 'text',
    });
    return response.data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0;
    throw new ScrapeError(
      `${store} Product API failed (HTTP ${status})`,
      axios.isAxiosError(error) && error.code === 'ECONNABORTED'
        ? 'timeout'
        : status === 401 || status === 402
          ? 'unsupported'
          : kindForStatus(status),
    );
  }
}

async function dedicatedSearchRequest(
  endpoint: 'amazon' | 'flipkart',
  params: Record<string, string>,
): Promise<string> {
  const key = process.env.SCRAPINGDOG_API_KEY;
  if (!key) throw new ScrapeError('ScrapingDog API key is missing.', 'unsupported');
  reservePreviewProviderRequest(endpoint, 'search');
  try {
    const response = await axios.get(`https://api.scrapingdog.com/${endpoint}/search`, {
      params: { api_key: key, ...params },
      timeout: 60_000,
      maxRedirects: 0,
      maxContentLength: 10 * 1024 * 1024,
      responseType: 'text',
    });
    return response.data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0;
    throw new ScrapeError(
      `${endpoint} Search API failed (HTTP ${status})`,
      axios.isAxiosError(error) && error.code === 'ECONNABORTED'
        ? 'timeout'
        : status === 401 || status === 402
          ? 'unsupported'
          : kindForStatus(status),
    );
  }
}

/** Dedicated Amazon India search transport; fixed first page and region. */
export async function fetchAmazonSearchJSON(query: string): Promise<string> {
  if (!query.trim() || query.length > 500)
    throw new ScrapeError('Invalid Amazon search query', 'disallowed');
  return dedicatedSearchRequest('amazon', {
    query: query.trim(),
    domain: 'in',
    page: '1',
    country: 'in',
  });
}

export async function fetchFlipkartSearchJSON(input: string): Promise<string> {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.flipkart.com' ||
    url.pathname !== '/search' ||
    url.username ||
    url.password ||
    url.port ||
    !url.searchParams.get('q')
  )
    throw new ScrapeError('Invalid Flipkart search URL', 'disallowed');
  await assertPublicURL(url);
  // Provider API only; direct/generic crawling retains its existing robots guard.
  await throttle(input);
  return dedicatedSearchRequest('flipkart', { url: url.toString() });
}

/** Dedicated search: fixed provider host, one request, no general-scraper wrapping. */
export async function fetchMyntraSearchJSON(input: string): Promise<string> {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    !/^(www\.)?myntra\.com$/i.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    /\/buy\/?$/.test(url.pathname)
  )
    throw new ScrapeError('Invalid Myntra search URL', 'disallowed');
  const key = process.env.SCRAPINGDOG_API_KEY;
  if (!key) throw new ScrapeError('ScrapingDog API key is missing.', 'unsupported');
  await assertPublicURL(url);
  await assertRobotsAllowed(url);
  await throttle(url.toString());
  reservePreviewProviderRequest('myntra', 'search');
  try {
    const response = await axios.get('https://api.scrapingdog.com/myntra/search', {
      params: { api_key: key, url: url.toString() },
      responseType: 'text',
      maxRedirects: 0,
      timeout: 60_000,
      maxContentLength: 10 * 1024 * 1024,
    });
    return response.data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0;
    throw new ScrapeError(
      `Myntra Search API failed (HTTP ${status})`,
      axios.isAxiosError(error) && error.code === 'ECONNABORTED'
        ? 'timeout'
        : status === 401 || status === 402
          ? 'unsupported'
          : kindForStatus(status),
    );
  }
}

/** Strict store URL validation before passing a user URL to the fixed API host. */
export function myntraProductID(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ScrapeError('Invalid Myntra product URL', 'disallowed');
  }
  const id = url.pathname.match(/\/(\d+)\/buy\/?$/)?.[1];
  if (
    url.protocol !== 'https:' ||
    !/^(www\.)?myntra\.com$/i.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !id
  )
    throw new ScrapeError('Invalid Myntra product URL', 'disallowed');
  return id;
}

export async function fetchMyntraProductJSON(input: string): Promise<string> {
  myntraProductID(input);
  const apiKey = process.env.SCRAPINGDOG_API_KEY;
  if (!apiKey) throw new ScrapeError('ScrapingDog API key is missing.', 'unsupported');
  // Retain the existing store safeguards before making a paid request.
  await assertPublicURL(input);
  await assertRobotsAllowed(input);
  await throttle(input);
  const url = new URL(input);
  url.search = '';
  url.hash = '';
  reservePreviewProviderRequest('myntra', 'product');
  try {
    const response = await axios.get('https://api.scrapingdog.com/myntra/product', {
      params: { api_key: apiKey, url: url.toString() },
      timeout: 60_000,
      maxRedirects: 0,
      maxContentLength: 10 * 1024 * 1024,
      responseType: 'text',
    });
    return response.data;
  } catch (error) {
    // Never propagate Axios errors/config: they can contain the API key.
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      throw new ScrapeError(
        `Myntra Product API failed (HTTP ${status})`,
        error.code === 'ECONNABORTED'
          ? 'timeout'
          : status === 401 || status === 402
            ? 'unsupported'
            : kindForStatus(status),
      );
    }
    throw new ScrapeError('Myntra Product API request failed', 'unavailable');
  }
}

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function isPrivateAddress(address: string) {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return (
      a === '::1' ||
      a === '::' ||
      a.startsWith('fc') ||
      a.startsWith('fd') ||
      a.startsWith('fe80')
    );
  }
  return PRIVATE_V4.some((range) => range.test(address));
}

export async function assertPublicURL(input: string | URL) {
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new ScrapeError('Only http(s) links are supported', 'disallowed');
  if (url.port && url.port !== '80' && url.port !== '443')
    throw new ScrapeError('Unsupported port', 'disallowed');
  if (url.username || url.password)
    throw new ScrapeError('Links with credentials are not supported', 'disallowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    throw new ScrapeError('That address is not allowed', 'disallowed');
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length)
    throw new ScrapeError('Could not resolve that website', 'not-found');
  if (addresses.some(({ address }) => isPrivateAddress(address)))
    throw new ScrapeError('That address is not allowed', 'disallowed');
  return url;
}

const REQUEST_CONFIG: AxiosRequestConfig = {
  timeout: 20_000,
  maxRedirects: 3,
  maxContentLength: 8 * 1024 * 1024,
  responseType: 'text',
  headers: {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml',
  },
  beforeRedirect: (options) => {
    const host = String(options.hostname ?? '');
    if (host === 'localhost' || (isIP(host) && isPrivateAddress(host)))
      throw new ScrapeError('Redirect to a private address was blocked', 'disallowed');
  },
};

async function fetchViaScrapingDog(url: string): Promise<string> {
  const apiKey = process.env.SCRAPINGDOG_API_KEY;
  if (!apiKey) throw new ScrapeError('ScrapingDog API key is missing.', 'unsupported');

  const endpoint = new URL('https://api.scrapingdog.com/scrape');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('dynamic', 'true'); // Flipkart ke liye JS Rendering
  endpoint.searchParams.set('premium', 'true'); // Flipkart ka block hatane ke liye
  endpoint.searchParams.set('country', 'in');

  try {
    const response = await axios.get(endpoint.toString(), {
      timeout: 60_000,
      maxContentLength: 10 * 1024 * 1024,
      responseType: 'text',
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      throw new ScrapeError(
        `ScrapingDog failed (HTTP ${status})`,
        error.code === 'ECONNABORTED' ? 'timeout' : kindForStatus(status),
      );
    }
    throw new ScrapeError('ScrapingDog request failed', 'unsupported');
  }
}

export async function fetchHtml(url: string, headers?: Record<string, string>) {
  denyPreviewGenericRequest();
  await assertPublicURL(url);
  await assertRobotsAllowed(url);
  await throttle(url);
  if (process.env.SCRAPINGDOG_API_KEY && !headers) return fetchViaScrapingDog(url);
  try {
    const response = await axios.get(
      url,
      headers
        ? { ...REQUEST_CONFIG, headers: { ...REQUEST_CONFIG.headers, ...headers } }
        : REQUEST_CONFIG,
    );
    return response.data;
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    const status = axios.isAxiosError(error) ? (error.response?.status ?? 0) : 0;
    throw new ScrapeError('Could not load the page', kindForStatus(status));
  }
}
