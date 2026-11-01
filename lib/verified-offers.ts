import type { Offer } from '@/types';
import { isAccessory, isPlausiblePrice } from './scraper/match';

export type MatchIdentity = {
  title: string;
  brand?: string;
  model?: string;
  variant?: string;
  gtin?: string;
  mpn?: string;
};

// Marketing/category words provide no evidence that two listings are identical.
// Preserve names, colours, model suffixes, quantities and concentration variants.
const NOISE = new Set(
  (
    'the and for with from of in on by to a an at or buy online best price new original genuine india warranty offer deal ' +
    'premium long lasting longlasting perfume fragrance perfumes wireless bluetooth smartphone mobile phone device ' +
    'headphones headphone ear over mic microphone clear calling active noise cancelling cancellation ' +
    'ergonomic optical ultra fast scrolling edition storage'
  ).split(' '),
);

function words(title: string) {
  return title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/eau\s+de\s+parfum/g, 'edp')
    .replace(/eau\s+de\s+toilette/g, 'edt')
    .replace(
      /(\d+(?:\.\d+)?)\s*(millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|kilograms?|kg|grams?|g)\b/g,
      (_, value, unit: string) => {
        const volume = /^(ml|mill|l|lit)/.test(unit);
        const multiplier =
          /^(l|lit|kg|kilogram)/.test(unit) && !unit.startsWith('mill') ? 1000 : 1;
        return `${Number(value) * multiplier}${volume ? 'ml' : 'g'}`;
      },
    )
    .replace(/(\d+)\s+(gb|tb|mah|w|hz|mm|inch|hr)\b/g, '$1$2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !NOISE.has(w));
}

/** Conservative title evidence. Missing details do not prove an exact match. */
export function isVerifiedMatch(source: MatchIdentity, candidate: MatchIdentity) {
  for (const key of ['brand', 'model', 'variant', 'gtin', 'mpn'] as const) {
    if (
      source[key] &&
      candidate[key] &&
      source[key]!.trim().toLowerCase() !== candidate[key]!.trim().toLowerCase()
    )
      return false;
  }
  if (
    isAccessory(candidate.title, source.title) ||
    isAccessory(source.title, candidate.title)
  )
    return false;
  const a = words(source.title),
    b = words(candidate.title);
  if (a.length < 2 || b.length < 2 || a[0] !== b[0]) return false;
  const x = new Set(a),
    y = new Set(b);
  return x.size === y.size && [...x].every((w) => y.has(w));
}

/** Discovery may use a partial query, but every distinctive query word must occur. */
export function matchesDiscoveryQuery(query: string, title: string) {
  const q = words(query),
    t = new Set(words(title));
  return q.length >= 2 && q.every((word) => t.has(word));
}

type Source = MatchIdentity & {
  url: string;
  store: string;
  currency: string;
  currentPrice: number;
  offers?: Offer[];
};

/** Recheck persisted offers at render time; never mutate the database or source. */
export function verifiedOffers(
  product: Source,
  candidates: Offer[] = product.offers ?? [],
) {
  return candidates
    .filter((offer) => {
      if (
        !Number.isFinite(offer.price) ||
        offer.price <= 0 ||
        offer.currency !== product.currency
      )
        return false;
      try {
        if (!['http:', 'https:'].includes(new URL(offer.url).protocol)) return false;
      } catch {
        return false;
      }
      if (offer.store === product.store) {
        return (
          offer.url === product.url &&
          offer.title === product.title &&
          offer.price === product.currentPrice
        );
      }
      return (
        isVerifiedMatch(product, offer) &&
        isPlausiblePrice(offer.price, product.currentPrice)
      );
    })
    .sort((a, b) => a.price - b.price);
}
