import 'server-only';
import { parseDryRunRequest } from './preview-fragrance-dry-run';

/** Website test only. Never add this target to the read-only diagnostic. */
export const HUSTLER_PREVIEW_TEST_URL =
  'https://www.flipkart.com/bla-bli-blu-hustler-perfume-men-citrus-fruity-notes-long-lasting-90-ml/p/itm56964b5578199?pid=PERHQ4H22Z4SRTGU&lid=LSTPERHQ4H22Z4SRTGUEGJMT8&marketplace=FLIPKART';

export function previewWebsiteTestTarget(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  // Exact approved URL, retaining PID, listing selector and marketplace. No
  // stripped selectors, arbitrary aliases or product-ID-only matching.
  if (input === HUSTLER_PREVIEW_TEST_URL) return input;
  return parseDryRunRequest({ url: input })?.url;
}
