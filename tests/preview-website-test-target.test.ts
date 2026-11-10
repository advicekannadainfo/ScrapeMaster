import { describe, expect, it } from 'vitest';
import {
  HUSTLER_PREVIEW_TEST_URL,
  previewWebsiteTestTarget,
} from '@/lib/preview-website-test-target';
import {
  DRY_RUN_INPUT_URL,
  DRY_RUN_URL,
  parseDryRunRequest,
} from '@/lib/preview-fragrance-dry-run';

describe('website-only exact test allowlist (pure offline checks, no IO)', () => {
  it('retains the exact Hustler PID, listing selector and marketplace', () => {
    expect(previewWebsiteTestTarget(HUSTLER_PREVIEW_TEST_URL)).toBe(
      HUSTLER_PREVIEW_TEST_URL,
    );
    expect(new URL(HUSTLER_PREVIEW_TEST_URL).search).toBe(
      '?pid=PERHQ4H22Z4SRTGU&lid=LSTPERHQ4H22Z4SRTGUEGJMT8&marketplace=FLIPKART',
    );
  });
  it.each([
    HUSTLER_PREVIEW_TEST_URL.split('&lid=')[0],
    HUSTLER_PREVIEW_TEST_URL.replace('&marketplace=FLIPKART', ''),
    HUSTLER_PREVIEW_TEST_URL.replace('lid=LSTPERHQ4H22Z4SRTGUEGJMT8', 'lid=OTHER'),
    HUSTLER_PREVIEW_TEST_URL.replace('pid=PERHQ4H22Z4SRTGU', 'pid=OTHER'),
    HUSTLER_PREVIEW_TEST_URL.replace('itm56964b5578199', 'itm0000000000000'),
    `${HUSTLER_PREVIEW_TEST_URL}&extra=unapproved`,
    HUSTLER_PREVIEW_TEST_URL.replace('www.flipkart.com', 'evil.example'),
    HUSTLER_PREVIEW_TEST_URL.replace('https:', 'http:'),
    'https://www.amazon.in/dp/B0FYGRL51R',
    null,
    { url: HUSTLER_PREVIEW_TEST_URL },
  ])('rejects non-approved selectors, products and input shapes %#', (input) => {
    expect(previewWebsiteTestTarget(input)).toBeUndefined();
  });
  it('preserves Old Money aliases and never expands the diagnostic allowlist', () => {
    expect(previewWebsiteTestTarget(DRY_RUN_INPUT_URL)).toBe(DRY_RUN_URL);
    expect(previewWebsiteTestTarget(DRY_RUN_URL)).toBe(DRY_RUN_URL);
    expect(parseDryRunRequest({ url: HUSTLER_PREVIEW_TEST_URL })).toBeUndefined();
    expect(
      parseDryRunRequest({ url: HUSTLER_PREVIEW_TEST_URL, mode: 'amazon-only' }),
    ).toBeUndefined();
  });
});
