import { describe, expect, it } from 'vitest';
import {
  LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
  previewWebsiteTestTarget,
} from '@/lib/preview-website-test-target';
import {
  DRY_RUN_INPUT_URL,
  DRY_RUN_URL,
  parseDryRunRequest,
} from '@/lib/preview-fragrance-dry-run';

describe('website-only exact test allowlist (pure offline checks, no IO)', () => {
  it('retains the exact Love Drunk 100ml PID, listing selector and marketplace', () => {
    expect(previewWebsiteTestTarget(LOVE_DRUNK_100ML_PREVIEW_TEST_URL)).toBe(
      LOVE_DRUNK_100ML_PREVIEW_TEST_URL,
    );
    expect(new URL(LOVE_DRUNK_100ML_PREVIEW_TEST_URL).search).toBe(
      '?pid=PERHEV7YFJMY2UWG&lid=LSTPERHEV7YFJMY2UWG4A1W6J&marketplace=FLIPKART',
    );
  });
  it.each([
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL.split('&lid=')[0],
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL.replace('&marketplace=FLIPKART', ''),
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL.replace(
      'lid=LSTPERHEV7YFJMY2UWG4A1W6J',
      'lid=OTHER',
    ),
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL.replace('pid=PERHEV7YFJMY2UWG', 'pid=OTHER'),
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL.replace('itm5e9143b8c1cbc', 'itm0000000000000'),
    `${LOVE_DRUNK_100ML_PREVIEW_TEST_URL}&extra=unapproved`,
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL.replace('www.flipkart.com', 'evil.example'),
    LOVE_DRUNK_100ML_PREVIEW_TEST_URL.replace('https:', 'http:'),
    'https://www.amazon.in/dp/B0FYGRL51R',
    'https://www.flipkart.com/bla-bli-blu-hustler-perfume-men-citrus-fruity-notes-long-lasting-90-ml/p/itm56964b5578199?pid=PERHQ4H22Z4SRTGU&lid=LSTPERHQ4H22Z4SRTGUEGJMT8&marketplace=FLIPKART',
    null,
    { url: LOVE_DRUNK_100ML_PREVIEW_TEST_URL },
  ])('rejects non-approved selectors, products and input shapes %#', (input) => {
    expect(previewWebsiteTestTarget(input)).toBeUndefined();
  });
  it('preserves Old Money aliases and never expands the diagnostic allowlist', () => {
    expect(previewWebsiteTestTarget(DRY_RUN_INPUT_URL)).toBe(DRY_RUN_URL);
    expect(previewWebsiteTestTarget(DRY_RUN_URL)).toBe(DRY_RUN_URL);
    expect(
      parseDryRunRequest({ url: LOVE_DRUNK_100ML_PREVIEW_TEST_URL }),
    ).toBeUndefined();
    expect(
      parseDryRunRequest({ url: LOVE_DRUNK_100ML_PREVIEW_TEST_URL, mode: 'amazon-only' }),
    ).toBeUndefined();
  });
});
