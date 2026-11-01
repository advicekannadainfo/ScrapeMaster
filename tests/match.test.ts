import { describe, expect, it } from 'vitest';
import {
  isAccessory,
  isPlausiblePrice,
  MATCH_THRESHOLD,
  searchQuery,
  titleSimilarity,
} from '@/lib/scraper/match';
import { parseAmazonSearch } from '@/lib/scraper/stores/amazon';

describe('titleSimilarity', () => {
  const source = 'Apple iPhone 15 (128 GB) - Black';

  it('rejects explicit bundles while allowing ordinary product descriptors', () => {
    expect(titleSimilarity(source, `${source} combo pack`)).toBe(0);
    expect(
      titleSimilarity('iPhone 15 Pro Plus', 'iPhone 15 Pro Plus with warranty'),
    ).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('matches the same product across stores', () => {
    expect(
      titleSimilarity(source, 'Apple iPhone 15 (Black, 128 GB)'),
    ).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('rejects a different capacity or model', () => {
    expect(titleSimilarity(source, 'Apple iPhone 15 (Black, 256 GB)')).toBeLessThan(
      titleSimilarity(source, 'Apple iPhone 15 (Black, 128 GB)'),
    );
    expect(titleSimilarity(source, 'Samsung Galaxy S24 Ultra')).toBeLessThan(
      MATCH_THRESHOLD,
    );
  });

  // Real title pairs observed on Amazon.in and Flipkart.
  it.each([
    [
      'Sony WH-1000XM5 Best Active Noise Cancelling Wireless Bluetooth Over Ear Headphones with Mic',
      'SONY WH-1000XM5 Wireless Noise Cancellation Headphones',
    ],
    [
      'Sony WH-1000XM5 Best Active Noise Cancelling Wireless Bluetooth Over Ear Headphones with Mic for Clear Calling',
      'SONY WH-1000XM5 Wireless Noise Cancellation Headphones with Mic',
    ],
    [
      'Samsung Galaxy S24 5G AI Smartphone (Onyx Black, 8GB, 256GB Storage)',
      'Samsung Galaxy S24 5G (Amber Yellow, 256 GB)',
    ],
    [
      'Logitech MX Master 3S Bluetooth Edition Wireless Mouse, Ultra-fast Scrolling',
      'Logitech MX Master 3s Ergonomic Optical Mouse',
    ],
    [
      'JBL Flip 6 Wireless Portable Bluetooth Speaker Pro Sound, Upto 12 Hours Playtime',
      'JBL Flip 6 with 12Hr Playtime, Customizable Sound 30 W Bluetooth Speaker',
    ],
  ])('matches verbose and terse listings of the same product', (a, b) => {
    expect(titleSimilarity(a, b)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('flags accessories that mention the product', () => {
    expect(
      isAccessory('OnePlus Nord CE4 Sandstone Bumper Case Black', 'OnePlus Nord CE4 5G'),
    ).toBe(true);
    expect(
      isAccessory(
        'Cartoon Silicone Case Compatible with Apple AirPods Pro',
        'AirPods Pro',
      ),
    ).toBe(true);
    expect(
      isAccessory('OnePlus Nord CE4 (Dark Chrome, 128 GB)', 'OnePlus Nord CE4 5G'),
    ).toBe(false);
  });

  it('rejects implausible prices', () => {
    expect(isPlausiblePrice(199, 24999)).toBe(false);
    expect(isPlausiblePrice(23999, 24999)).toBe(true);
  });

  it('builds a short search query', () => {
    expect(
      searchQuery('Sony WH-1000XM5 Wireless Headphones (Black) | Industry leading ANC'),
    ).toBe('Sony WH 1000XM5 Wireless Headphones');
  });
});

describe('parseAmazonSearch', () => {
  it('skips sponsored results', () => {
    const html = `
      <div data-component-type="s-search-result" data-asin="B0CHX1W1XY">
        <h2><span>Apple iPhone 15 (128 GB) - Black</span></h2>
        <span class="a-price"><span class="a-offscreen">₹69,900</span><span class="a-price-symbol">₹</span></span>
        <span class="a-price a-text-price"><span class="a-offscreen">₹79,900</span></span>
      </div>
      <div data-component-type="s-search-result" data-asin="B0SPONSORED">
        <span class="puis-sponsored-label-text">Sponsored</span>
        <h2><span>Case</span></h2><span class="a-price"><span class="a-offscreen">₹299</span></span>
      </div>`;
    const offers = parseAmazonSearch(html, 'https://www.amazon.in/s?k=iphone');
    expect(offers).toEqual([
      expect.objectContaining({
        url: 'https://www.amazon.in/dp/B0CHX1W1XY',
        price: 69900,
        originalPrice: 79900,
        currency: '₹',
      }),
    ]);
  });
});
