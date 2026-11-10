import 'server-only';
import { parseDryRunRequest } from './preview-fragrance-dry-run';

/** Website test only. Never add this target to the read-only diagnostic. */
export const LOVE_DRUNK_100ML_PREVIEW_TEST_URL =
  'https://www.flipkart.com/bla-bli-blu-love-drunk-perfume-men-women-cinnamon-date-notes-long-lasting-100-ml/p/itm5e9143b8c1cbc?pid=PERHEV7YFJMY2UWG&lid=LSTPERHEV7YFJMY2UWG4A1W6J&marketplace=FLIPKART';

export function previewWebsiteTestTarget(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  // Exact approved URL, retaining PID, listing selector and marketplace. No
  // stripped selectors, arbitrary aliases or product-ID-only matching.
  if (input === LOVE_DRUNK_100ML_PREVIEW_TEST_URL) return input;
  return parseDryRunRequest({ url: input })?.url;
}
