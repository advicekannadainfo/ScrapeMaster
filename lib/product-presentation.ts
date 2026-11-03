export const DESCRIPTION_UNAVAILABLE = 'Product description is not available yet.';
export const EXACT_OFFERS_UNVERIFIED = 'Exact matching offers not verified yet';

/** Root description text only; never render parser proof notes from old DB records.
 * React renders this as text. HTML/credential-like/diagnostic content is not used. */
export function customerProductDescription(value: unknown): string {
  if (typeof value !== 'string') return DESCRIPTION_UNAVAILABLE;
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (
    !text ||
    text.length > 6000 ||
    /<[^>]*>/.test(text) ||
    /URL-based provider response|\bcorroboration\b|response (?:SKU|PID)|comparisonIdentityVerified|validated main-product price|^Amazon ASIN\b|^Myntra product \d+\.|api[_ -]?key|authorization\s*:|bearer\s+|(?:password|token)=/i.test(
      text,
    )
  )
    return DESCRIPTION_UNAVAILABLE;
  return text;
}

/** Main-product fields only. Objects/nested lists are deliberately unsupported. */
export function mainProductDescription(...sources: unknown[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  let length = 0;
  for (const source of sources) {
    const items =
      typeof source === 'string'
        ? [source]
        : Array.isArray(source)
          ? source.slice(0, 32)
          : [];
    for (const item of items) {
      if (typeof item !== 'string' || item.length > 12000) continue;
      for (const raw of item.split(/\r?\n/).slice(0, 32)) {
        const line = raw
          .trim()
          .replace(/^(?:[•*]|-)\s+/, '')
          .replace(/[\t ]+/g, ' ');
        if (
          line.length > 1500 ||
          customerProductDescription(line) === DESCRIPTION_UNAVAILABLE
        )
          continue;
        const key = line
          .normalize('NFKC')
          .toLowerCase()
          .replace(/[.。]+$/, '');
        if (seen.has(key)) continue;
        if (lines.length >= 8 || length + line.length + lines.length > 6000)
          return lines.join('\n');
        seen.add(key);
        lines.push(line);
        length += line.length;
      }
    }
  }
  return lines.join('\n') || DESCRIPTION_UNAVAILABLE;
}
