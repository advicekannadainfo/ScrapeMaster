import { describe, expect, it, vi, afterEach } from 'vitest';
afterEach(() => vi.unstubAllEnvs());
import {
  flipkart,
  parseFlipkartProduct,
  parseFlipkartAffiliateSearch,
} from '@/lib/scraper/stores/flipkart';

const product = `
<html><body>
  <div class="r2CdBx"><a>Home</a><a>Mobiles</a><a>Apple iPhones</a><a>iPhone 15</a></div>
  <h1><span class="VU-ZEz">Apple iPhone 15 (Black, 128 GB)</span></h1>
  <div class="Nx9bqj CxhGGd">₹65,999</div>
  <div class="yRaY8j A6+E6v">₹79,900</div>
  <img class="DByuf4" src="https://rukminim2.flixcart.com/image/iphone.jpg" />
  <div class="XQDdHH">4.6</div>
  <span class="Wphh3N">2,31,450 Ratings</span>
  <ul><li class="_7eSDEz">128 GB ROM</li><li class="_7eSDEz">48MP Camera</li></ul>
</body></html>`;

const affiliate = JSON.stringify({
  products: [
    {
      productBaseInfoV1: {
        title: 'Apple iPhone 15  (Black, 128 GB)',
        productUrl:
          'http://dl.flipkart.com/dl/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W&affid=me',
        imageUrls: { '200x200': 'https://img/200.jpg', '400x400': 'https://img/400.jpg' },
        maximumRetailPrice: { amount: 79900, currency: 'INR' },
        flipkartSellingPrice: { amount: 69900, currency: 'INR' },
        flipkartSpecialPrice: { amount: 65999, currency: 'INR' },
        inStock: true,
      },
    },
    { productBaseInfoV1: { title: 'Sold out', productUrl: '/x/p/1', inStock: false } },
    { productBaseInfoV1: { title: 'No price', productUrl: '/x/p/2' } },
  ],
});

describe('flipkart adapter', () => {
  it('rejects an app shell with a heading but no price', () => {
    expect(() =>
      parseFlipkartProduct('<h1>Flipkart</h1>', 'https://www.flipkart.com/x/p/1'),
    ).toThrow(/no valid product price/);
  });
  it('parses a product page', () => {
    expect(
      parseFlipkartProduct(product, 'https://www.flipkart.com/x/p/itm1'),
    ).toMatchObject({
      store: 'flipkart',
      title: 'Apple iPhone 15 (Black, 128 GB)',
      currency: '₹',
      currentPrice: 65999,
      originalPrice: 79900,
      discountRate: 17,
      stars: 4.6,
      reviewsCount: 231450,
      category: 'Apple iPhones',
      description: '128 GB ROM\n48MP Camera',
    });
  });

  it('reads Affiliate API search results as canonical offers', () => {
    expect(parseFlipkartAffiliateSearch(affiliate)).toEqual([
      {
        store: 'flipkart',
        storeName: 'Flipkart',
        title: 'Apple iPhone 15 (Black, 128 GB)',
        url: 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W',
        price: 65999,
        originalPrice: 79900,
        currency: '₹',
        image: 'https://img/400.jpg',
      },
    ]);
  });

  it('rejects an unreadable API response', () => {
    expect(() => parseFlipkartAffiliateSearch('<html>')).toThrow(/unreadable/);
  });

  it('only searches when affiliate credentials are configured', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    expect(flipkart.search?.enabled?.()).toBe(false);
  });

  it('normalizes product URLs to path + pid', () => {
    vi.stubEnv('SCRAPINGDOG_API_KEY', '');
    const url = new URL('https://dl.flipkart.com/s/x/p/itm1?pid=ABC&lid=1&affid=me');
    expect(flipkart.matches(url)).toBe(true);
    expect(flipkart.normalize(url)).toBe('https://www.flipkart.com/s/x/p/itm1?pid=ABC');
  });
});
