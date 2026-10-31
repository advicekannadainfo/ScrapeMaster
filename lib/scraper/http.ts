import 'server-only';
import axios from 'axios';
import { USER_AGENT } from './agent';
import { kindForStatus, ScrapeError } from './errors';

export { ScrapeError };

async function fetchViaScrapingDog(url: string): Promise<string> {
  const apiKey = process.env.SCRAPINGDOG_API_KEY;
  if (!apiKey) throw new ScrapeError('ScrapingDog API key is missing.', 'unsupported');

  const endpoint = new URL('https://api.scrapingdog.com/scrape');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('render_js', 'true'); // JS rendering ON (Flipkart/Myntra ke liye)
  endpoint.searchParams.set('premium', 'true');   // Premium Proxy ON (Block hatane ke liye)
  endpoint.searchParams.set('country', 'in');     // India ka IP

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
      throw new ScrapeError(`ScrapingDog failed (HTTP ${status})`, kindForStatus(status));
    }
    throw new ScrapeError('ScrapingDog request failed', 'unsupported');
  }
}

export async function fetchHtml(url: string, headers?: Record<string, string>) {
  // Always use ScrapingDog if API key is present
  if (process.env.SCRAPINGDOG_API_KEY && !headers) {
    return fetchViaScrapingDog(url);
  }

  try {
    const response = await axios.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': USER_AGENT, ...headers }
    });
    return response.data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status ?? 0 : 0;
    throw new ScrapeError('Could not load the page', kindForStatus(status));
  }
}
