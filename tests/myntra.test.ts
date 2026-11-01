import { describe, expect, it } from 'vitest';
import { parseMyntraProduct, myntra } from '@/lib/scraper/stores/myntra';
import { resolveStore } from '@/lib/scraper/stores';

const url = 'https://www.myntra.com/shirts/brand/shirt/12345/buy';

describe('Myntra adapter', () => {
  it('reads rendered product markup', () => {
    expect(
      parseMyntraProduct(
        `<h1 class="pdp-title">Brand</h1>
      <h1 class="pdp-name">Cotton Shirt</h1><span class="pdp-price">₹999</span>
      <span class="pdp-mrp">MRP ₹1,999</span>`,
        url,
      ),
    ).toMatchObject({
      title: 'Brand Cotton Shirt',
      currentPrice: 999,
      originalPrice: 1999,
      currency: '₹',
      store: 'myntra.com',
    });
  });

  it('reads embedded JSON with nested braces and escaped quotes', () => {
    const state = {
      pdpData: {
        name: 'Shirt {Slim} "Blue"',
        discountedPrice: 799,
        mrp: 1599,
        media: { albums: [{ images: [{ src: '/shirt.jpg' }] }] },
      },
    };
    expect(
      parseMyntraProduct(
        `<script>window.__myx = ${JSON.stringify(state)}; other();</script>`,
        url,
      ),
    ).toMatchObject({
      title: state.pdpData.name,
      currentPrice: 799,
      image: 'https://www.myntra.com/shirt.jpg',
    });
  });

  it('falls back to structured product data', () => {
    expect(
      parseMyntraProduct(
        `<script type="application/ld+json">${JSON.stringify({
          '@type': 'Product',
          name: 'Shirt',
          offers: { price: 999, priceCurrency: 'INR' },
        })}</script>`,
        url,
      ),
    ).toMatchObject({ title: 'Shirt', currentPrice: 999 });
  });

  it('rejects blocked pages and malformed state', () => {
    expect(() =>
      parseMyntraProduct(
        '<script>window.__myx = {bad};</script><h1>Access denied</h1>',
        url,
      ),
    ).toThrow(/Could not find product details/);
  });

  it('resolves only Myntra hosts and removes tracking parameters', () => {
    expect(resolveStore(new URL(url))).toBe(myntra);
    expect(myntra.matches(new URL('https://myntra.com.example.org/'))).toBe(false);
    expect(myntra.normalize(new URL(`${url}?utm_source=mail#details`))).toBe(url);
  });
});
