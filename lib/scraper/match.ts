const STOPWORDS = new Set(
  (
    'the and for with from new of in on by to a an at or buy online best price edition version latest pack ' +
    'wireless bluetooth smartphone mobile phone device original genuine india warranty offer deal ' +
    'black white blue silver grey gray green red pink yellow gold purple midnight starlight graphite ' +
    'titanium natural space amber cream violet chrome dark light'
  ).split(' '),
);

const ACCESSORY = new RegExp(
  '\\b(case|cases|cover|covers|bumper|skin|sleeve|pouch|compatible|protector|tempered|screen guard|' +
    'strap|band for|replacement|refurbished|renewed|charger|cable|adapter|stand|holder|mount|ear ?tips|' +
    'sticker|decal|lens guard|for (apple|samsung|oneplus|sony|iphone|airpods|galaxy))\\b',
  'i',
);

const UNITS = new Set([
  'gb',
  'tb',
  'mb',
  'mah',
  'w',
  'hz',
  'mm',
  'inch',
  'in',
  'l',
  'kg',
  'g',
  'hr',
  'hrs',
]);

export const MATCH_THRESHOLD = 0.6;

export function isPlausiblePrice(offer: number, reference: number) {
  return offer >= reference * 0.4 && offer <= reference * 2.5;
}

function stem(token: string) {
  if (/\d/.test(token) || token.length < 6) return token;
  return token.replace(/(ations?|ions?|ings?|ed|es|s)$/, '');
}

export function tokenize(title: string) {
  return new Set(
    title
      .toLowerCase()
      .replace(/(\d+)\s+(gb|tb|mb|mah|inch|in|w|hz|mm|l|kg|g|hr|hrs)\b/g, '$1$2')
      .split(/[^a-z0-9]+/)
      .filter((t) => (t.length > 1 || /\d/.test(t)) && !STOPWORDS.has(t))
      .map(stem),
  );
}

export function isAccessory(title: string, query: string) {
  return ACCESSORY.test(title) && !ACCESSORY.test(query);
}

function hasBundleKeywords(title: string): boolean {
  const lower = title.toLowerCase();
  return /\b(bundle|combo|pack of|set of|with|free|gift|plus)\b|\+/i.test(lower);
}

export function titleSimilarity(source: string, candidate: string) {
  const sourceHasBundle = hasBundleKeywords(source);
  const candidateHasBundle = hasBundleKeywords(candidate);
  if (sourceHasBundle !== candidateHasBundle) {
    return 0; 
  }

  const a = tokenize(source);
  const b = tokenize(candidate);
  if (!a.size || !b.size) return 0;

  const [short, long] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const token of short) if (long.has(token)) shared++;
  const containment = shared / short.size;

  const unitOf = (t: string) => t.match(/^\d+(?:\.\d+)?([a-z]+)$/)?.[1];
  const isUnit = (t: string) => {
    const unit = unitOf(t);
    return !!unit && UNITS.has(unit);
  };
  const specs = [...short].filter((t) => /\d/.test(t));
  const conflicts = specs.filter((t) => {
    if (long.has(t)) return false;
    if (!isUnit(t)) return true;
    return [...long].some((other) => isUnit(other) && unitOf(other) === unitOf(t));
  }).length;
  const penalty = specs.length ? (conflicts / specs.length) * 0.6 : 0;

  return Math.max(0, Math.round((containment - penalty) * 100) / 100);
}

export function searchQuery(title: string, words = 8) {
  return title
    .replace(/\(.*?\)|\[.*?\]|\|.*$|:.*$/g, ' ')
    .split(/[\s,–—-]+/)
    .filter(Boolean)
    .slice(0, words)
    .join(' ');
}
