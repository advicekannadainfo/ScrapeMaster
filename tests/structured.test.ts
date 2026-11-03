import { describe, expect, it } from 'vitest';
import { parseGenericProduct, storeFromHost } from '@/lib/scraper/stores/generic';
import { ScrapeError } from '@/lib/scraper/errors';

const jsonLd = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{
  "@type":"Product","name":"Galaxy Buds3 Pro","image":["/img/buds.jpg"],
  "description":"Wireless earbuds","brand":{"@type":"Brand","name":"Samsung"},
  "aggregateRating":{"ratingValue":"4.4","reviewCount":"1289"},
  "offers":{"@type":"Offer","price":"199.99","priceCurrency":"USD",
    "availability":"https://schema.org/InStock",
    "priceSpecification":[{"@type":"UnitPriceSpecification","priceType":"https://schema.org/ListPrice","price":249.99}]}
}]}
</script></head><body></body></html>`;

const metaOnly = `
<html><head>
<meta property="og:title" content="Linen Shirt" />
<meta property="og:image" content="https://cdn.shop.example/shirt.jpg" />
<meta property="product:price:amount" content="1,499.00" />
<meta property="product:price:currency" content="INR" />
<meta property="product:availability" content="out of stock" />
</head></html>`;

describe('generic adapter', () => {
  it('reads schema.org JSON-LD inside @graph', () => {
    const product = parseGenericProduct(
      jsonLd,
      'https://www.bestbuy.com/site/buds/123.p',
    );
    expect(product).toMatchObject({
      store: 'bestbuy.com',
      storeName: 'Best Buy',
      title: 'Galaxy Buds3 Pro',
      image: 'https://www.bestbuy.com/img/buds.jpg',
      currentPrice: 199.99,
      originalPrice: 249.99,
      discountRate: 20,
      currency: '$',
      stars: 4.4,
      reviewsCount: 1289,
      category: 'Samsung',
      isOutOfStock: false,
    });
  });

  it('falls back to OpenGraph product tags', () => {
    const product = parseGenericProduct(metaOnly, 'https://shop.example.in/p/linen');
    expect(product).toMatchObject({
      title: 'Linen Shirt',
      currentPrice: 1499,
      currency: '₹',
      isOutOfStock: true,
      storeName: 'Example',
    });
  });

  it('rejects pages without a price', () => {
    expect(() =>
      parseGenericProduct('<title>Blog</title>', 'https://blog.example.com/post'),
    ).toThrow(ScrapeError);
  });

  it('names known stores', () => {
    expect(storeFromHost('www.walmart.com').name).toBe('Walmart');
    expect(storeFromHost('m.myntra.com').name).toBe('Myntra');
    expect(storeFromHost('shop.acme.co').id).toBe('acme.co');
  });
});

describe('generic stock and currency evidence', () => {
  it('rejects missing stock rather than treating absence as in stock', () => {
    expect(() =>
      parseGenericProduct(
        metaOnly.replace(
          '<meta property="product:availability" content="out of stock" />',
          '',
        ),
        'https://shop.example.in/p/linen',
      ),
    ).toThrow(/stock or currency evidence/);
  });
  it('rejects missing currency rather than assuming dollars', () => {
    expect(() =>
      parseGenericProduct(
        metaOnly.replace('<meta property="product:price:currency" content="INR" />', ''),
        'https://shop.example.in/p/linen',
      ),
    ).toThrow(/stock or currency evidence/);
  });
});

describe('unknown availability cannot become verified stock', () => {
  it.each(['unknown', 'PreOrder', 'BackOrder', 'LimitedAvailability'])(
    'rejects unknown metadata availability %s',
    (status) => {
      expect(() =>
        parseGenericProduct(
          metaOnly.replace('out of stock', status),
          'https://shop.example.in/p/linen',
        ),
      ).toThrow(/stock or currency evidence/);
    },
  );
  it('rejects unknown schema.org availability', () => {
    expect(() =>
      parseGenericProduct(
        jsonLd.replace('schema.org/InStock', 'schema.org/Unknown'),
        'https://www.bestbuy.com/site/buds/123.p',
      ),
    ).toThrow(/stock or currency evidence/);
  });
});
