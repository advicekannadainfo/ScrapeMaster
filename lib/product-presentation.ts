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
