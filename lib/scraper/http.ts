import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import axios, { type AxiosRequestConfig } from 'axios';
import { USER_AGENT } from './agent';
import { kindForStatus, ScrapeError } from './errors';
import { assertRobotsAllowed } from './robots';
import { throttle } from './throttle';

export { ScrapeError };

const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function isPrivateAddress(address: string) {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
  }
  return PRIVATE_V4.some((range) => range.test(address));
}

export async function assertPublicURL(input: string | URL) {
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ScrapeError('Only http(s) links are supported', 'disallowed');
  if (url.port && url.port !== '80' && url.port !== '443') throw new ScrapeError('Unsupported port', 'disallowed');
  if (url.username || url.password) throw new ScrapeError('Links with credentials are not supported', 'disallowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new ScrapeError('That address is not allowed', 'disallowed');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new ScrapeError('Could not resolve that website', 'not-found');
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new ScrapeError('That address is not allowed', 'disallowed');
  return url;
}

const REQUEST_CONFIG: AxiosRequestConfig = {
  timeout: 20_000, maxRedirects: 3, maxContentLength: 8 * 1024 * 1024, responseType: 'text',
  headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' },
  beforeRedirect: (options) => {
    const host = String(options.hostname ?? '');
    if (host === 'localhost' || (isIP(host) && isPrivateAddress(host))) throw new ScrapeError('Redirect to a private address was blocked', 'disallowed');
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
    const response = await axios.get(endpoint.toString(), { timeout: 9500, maxContentLength: 10 * 1024 * 1024, responseType: 'text' });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      throw new ScrapeError(`ScrapingDog failed (HTTP ${status})`, kindForStatus(status));
    }
    throw new ScrapeError('ScrapingDog request failed', 'unsupported');
  }
}

export async function fetchHtml(url: string, headers?: Record<string, string>) {
  await assertPublicURL(url);
  if (process.env.SCRAPINGDOG_API_KEY && !headers) return fetchViaScrapingDog(url);
  await assertRobotsAllowed(url);
  await throttle(url);
  try {
    const response = await axios.get(url, headers ? { ...REQUEST_CONFIG, headers: { ...REQUEST_CONFIG.headers, ...headers } } : REQUEST_CONFIG);
    return response.data;
  } catch (error) {
    if (error instanceof ScrapeError) throw error;
    const status = axios.isAxiosError(error) ? error.response?.status ?? 0 : 0;
    throw new ScrapeError('Could not load the page', kindForStatus(status));
  }
}
