import { ScrapeError } from './errors';

function secureURL(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ScrapeError('Invalid product URL', 'disallowed');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new ScrapeError(
      'Product URL must use HTTPS without credentials or custom ports',
      'disallowed',
    );
  return url;
}

export function amazonIndiaProductInput(input: string) {
  const url = secureURL(input);
  if (!/^(www\.|m\.)?amazon\.in$/.test(url.hostname))
    throw new ScrapeError(
      'Dedicated Amazon Product API currently requires Amazon India',
      'disallowed',
    );
  const asin = url.pathname
    .match(/^\/(?:.*\/)?(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/|$)/i)?.[1]
    ?.toUpperCase();
  if (!asin) throw new ScrapeError('Amazon product URL has no valid ASIN', 'disallowed');
  // Quantity is not expressible by this API contract; do not silently turn a
  // multi-item cart URL into a single-item price.
  if (url.searchParams.has('quantity') && url.searchParams.get('quantity') !== '1')
    throw new ScrapeError('Amazon quantity selection is unsupported', 'unsupported');
  return { asin, url: `https://www.amazon.in/dp/${asin}` };
}

export function flipkartProductInput(input: string) {
  const url = secureURL(input);
  if (
    !/^(www\.|dl\.|m\.)?flipkart\.com$/.test(url.hostname) ||
    !/\/p\/itm[a-z0-9]+\/?$/i.test(url.pathname)
  )
    throw new ScrapeError('Invalid Flipkart product URL', 'disallowed');
  const ids = url.searchParams.getAll('pid');
  if (ids.length > 1 || (ids.length === 1 && !/^[a-z0-9]+$/i.test(ids[0])))
    throw new ScrapeError('Invalid or ambiguous Flipkart product ID', 'disallowed');
  if (
    url.searchParams.has('quantity') &&
    (url.searchParams.getAll('quantity').length !== 1 ||
      url.searchParams.get('quantity') !== '1')
  )
    throw new ScrapeError(
      'Flipkart multi-item quantity selection is unsupported',
      'unsupported',
    );
  if (['size', 'variant', 'sku'].some((key) => url.searchParams.has(key)))
    throw new ScrapeError(
      'Flipkart explicit variant selector is unsupported; use its exact product URL',
      'unsupported',
    );
  url.hostname = 'www.flipkart.com';
  url.hash = '';
  // Retain selectors rather than guessing which parameters affect a variant.
  return { url: url.toString(), pid: ids[0] };
}
