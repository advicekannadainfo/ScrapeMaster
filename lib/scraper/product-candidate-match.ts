/**
 * Extra identity evidence for independently fetched perfume product pages.
 * Ordinary products and search listings still use the stricter title matcher.
 * No price or URL is ever used as evidence of product identity.
 */
export type ProductCandidateIdentity = {
  title: string;
  brand?: string;
  variant?: string;
};

const brandKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function selectedVolume(value: string): number | undefined {
  const match =
    /^\s*(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\s*$/i.exec(value);
  if (!match) return;
  return Number(match[1]) * (/^(l|lit)/i.test(match[2]) ? 1000 : 1);
}

function fragranceName(title: string, brand: string): string | undefined {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  const brandWords = brandKey(brand);
  let consumed = '';
  let cursor = 0;
  // Brand may be printed as "BLA BLI BLU" or "BLABLIBLU".
  while (cursor < words.length && consumed.length < brandWords.length) {
    consumed += words[cursor++];
  }
  if (consumed !== brandWords) return;
  const generic = new Set([
    'perfume',
    'perfumes',
    'parfum',
    'fragrance',
    'fragrances',
    'unisex',
    'men',
    'women',
    'man',
    'woman',
    'for',
    'long',
    'lasting',
    'body',
    'spray',
  ]);
  const name: string[] = [];
  for (const word of words.slice(cursor)) {
    if (generic.has(word) || /^\d/.test(word)) break;
    name.push(word);
    if (name.length > 6) return;
  }
  return name.length >= 2 ? name.join(' ') : undefined;
}

export function matchingFetchedFragrance(
  source: ProductCandidateIdentity,
  candidate: ProductCandidateIdentity,
): boolean {
  if (!source.brand || !candidate.brand || !source.variant || !candidate.variant)
    return false;
  if (
    brandKey(source.brand).length < 4 ||
    brandKey(source.brand) !== brandKey(candidate.brand)
  )
    return false;
  const sourceSize = selectedVolume(source.variant);
  const candidateSize = selectedVolume(candidate.variant);
  if (!sourceSize || !candidateSize || sourceSize !== candidateSize) return false;
  // A claimed selected variant must never override a contradictory title quantity.
  const volumesInTitle = (title: string) =>
    [
      ...title.matchAll(
        /\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b/gi,
      ),
    ].map((m) => selectedVolume(`${m[1]} ${m[2]}`));
  if (
    [...volumesInTitle(source.title), ...volumesInTitle(candidate.title)].some(
      (size) => size !== sourceSize,
    )
  )
    return false;
  if (
    !/\b(perfume|parfum|fragrance)\b/i.test(source.title) ||
    !/\b(perfume|parfum|fragrance)\b/i.test(candidate.title)
  )
    return false;
  // Bundles and multipacks cannot be assumed to be single units.
  if (
    /\b(pack of|combo|bundle|set of|\d+\s*[x×]\s*\d+\s*ml)\b/i.test(
      source.title + ' ' + candidate.title,
    )
  )
    return false;
  const sourceName = fragranceName(source.title, source.brand);
  const candidateName = fragranceName(candidate.title, candidate.brand);
  return Boolean(sourceName && candidateName && sourceName === candidateName);
}
