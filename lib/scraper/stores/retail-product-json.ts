import { z } from 'zod';
import { ScrapeError } from '../errors';
import { amazonIndiaProductInput, flipkartProductInput } from '../retail-product-input';
import type { ScrapedProduct } from '@/types';
import { cachedFlipkartSearch } from '../flipkart-evidence';
import { categoryFor, selectedAttributes, titleAttributes } from '../product-identity';
import { isVerifiedMatch } from '@/lib/verified-offers';

const text = z.string().trim().min(1);
const positive = z.number().finite().positive();
const amazonSchema = z.object({
  title: text,
  main_title: text.optional(),
  product_information: z.object({
    ASIN: z.string().regex(/^[a-z0-9]{10}$/i),
    Brand: text,
    'Item Volume': text.optional(),
    'Package Size Name': text.optional(),
  }),
  extracted_price: positive,
  price_symbol: z.literal('₹'),
  main_image: z.string().url(),
  availability_status: text,
  purchase_options: z.object({
    single_offer: z.object({ extracted_price: positive, stock: text }),
  }),
  extracted_average_rating: z.number().min(0).max(5).optional(),
  extracted_total_reviews: z.number().int().nonnegative().optional(),
});
function fail(message: string): never {
  throw new ScrapeError(message, 'parse');
}
function readJSON(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return fail('Product API returned invalid JSON');
  }
}
function image(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    fail('Product API needs a valid HTTPS image');
  return url.toString();
}
function stock(value: string) {
  const s = value.trim().toLowerCase();
  if (s === 'in stock') return true;
  if (['out of stock', 'currently unavailable', 'sold out'].includes(s)) return false;
  return fail('Product API stock status is unknown or unsupported');
}
function volume(value: string) {
  const match =
    /^(\d+(?:\.\d+)?)\s*(ml|millilitres?|milliliters?|l|litres?|liters?)$/i.exec(
      value.trim(),
    );
  if (!match) return fail('Product selected quantity/pack format is unsupported');
  const ml = Number(match[1]) * (/^(l|lit)/i.test(match[2]) ? 1000 : 1);
  if (!Number.isFinite(ml) || ml <= 0) fail('Product selected volume is invalid');
  return ml;
}

/** Direct top-level India payload only. Related sections are deliberately never traversed. */
export function parseAmazonAPIProduct(body: string, input: string): ScrapedProduct {
  const target = amazonIndiaProductInput(input);
  const result = amazonSchema.safeParse(readJSON(body));
  if (!result.success) return fail('Amazon Product API fields are missing or invalid');
  const p = result.data;
  if (p.product_information.ASIN.toUpperCase() !== target.asin)
    fail('Amazon Product API returned a different ASIN');
  if (p.extracted_price !== p.purchase_options.single_offer.extracted_price)
    fail('Amazon selected-offer price conflicts with product price');
  const available = stock(p.availability_status);
  if (available !== stock(p.purchase_options.single_offer.stock))
    fail('Amazon selected-offer stock conflicts with product stock');
  const isPerfume = categoryFor(p.title) === 'perfume';
  const packageSize = p.product_information['Package Size Name'];
  const volumes = [
    p.product_information['Item Volume'],
    isPerfume ||
    (packageSize &&
      /^\d+(?:\.\d+)?\s*(ml|millilitres?|milliliters?|l|litres?|liters?)$/i.test(
        packageSize,
      ))
      ? packageSize
      : undefined,
  ]
    .filter((s): s is string => Boolean(s))
    .map(volume);
  if (new Set(volumes).size > 1) fail('Amazon selected quantity fields conflict');
  let title = isPerfume ? (p.main_title ?? p.title) : p.title;
  if (
    !isPerfume &&
    packageSize &&
    !title.toLowerCase().includes(packageSize.toLowerCase())
  )
    title += ` ${packageSize}`;
  // If both titles state quantities, neither may contradict the selected variant.
  const titleVolumes = [p.title, p.main_title ?? ''].flatMap((t) =>
    [
      ...t.matchAll(
        /\b\d+(?:\.\d+)?\s*(?:millilitres?|milliliters?|ml|litres?|liters?|l)\b/gi,
      ),
    ].map((m) => volume(m[0])),
  );
  if (volumes.length && titleVolumes.some((v) => v !== volumes[0]))
    fail('Amazon title quantity conflicts with selected variant');
  if (!volumes.length && titleVolumes.length)
    fail('Amazon title quantity lacks selected-variant confirmation');
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact(title).startsWith(compact(p.product_information.Brand)))
    title = `${p.product_information.Brand} ${title}`;
  const chosenTitleHasVolume =
    /\b\d+(?:\.\d+)?\s*(?:millilitres?|milliliters?|ml|litres?|liters?|l)\b/i.test(title);
  if (volumes.length && !chosenTitleHasVolume) title += ` ${volumes[0]}ml`;
  return {
    url: target.url,
    store: 'amazon',
    storeName: 'Amazon',
    storeProductId: target.asin,
    brand: p.product_information.Brand,
    variant: volumes.length ? `${volumes[0]}ml` : undefined,
    title,
    image: image(p.main_image),
    currency: '₹',
    currentPrice: p.extracted_price,
    originalPrice: p.extracted_price,
    discountRate: 0,
    description: `Amazon ASIN ${target.asin}. Selected single offer.`,
    category: 'General',
    isOutOfStock: !available,
    stars: p.extracted_average_rating ?? 0,
    reviewsCount: p.extracted_total_reviews ?? 0,
  };
}

const rupees = text
  .refine((v) =>
    /^₹\s*(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(v),
  )
  .transform((v) => Number(v.replace(/[₹,\s]/g, '')))
  .refine((n) => Number.isFinite(n) && n > 0);
const flipkartSchema = z.object({
  product_results: z.object({
    title: text,
    brand: text,
    price: rupees,
    previous_price: rupees.optional(),
    main_image: z.string().url(),
    overall_rating: z.number().min(0).max(5).optional(),
    ratings_count: z.number().int().nonnegative().optional(),
    specifications: z.object({ General: z.object({ 'Model Name': text }) }),
  }),
});

const numericText = text.regex(/^\d+(?:\.\d+)?$/).transform(Number);
const realFlipkartSchema = z.object({
  product_results: z.object({
    title: text,
    brand: text,
    price: rupees,
    previous_price: rupees.optional(),
    main_image: z.string().url(),
    sku: text.regex(/^[A-Z0-9]+$/),
    availability: z.enum(['InStock', 'OutOfStock']),
    ratings_reviews: z
      .object({
        rating: numericText.refine((n) => n <= 5).optional(),
        ratings_count: numericText.refine(Number.isInteger).optional(),
      })
      .optional(),
    specifications: z.object({
      General: z
        .object({
          Brand: text.optional(),
          'Model Name': text,
          Quantity: text.optional(),
          'Net Quantity': text.optional(),
        })
        .catchall(z.string()),
      'Product Highlights': z.object({ Quantity: text }).optional(),
    }),
    highlights: z.array(text).default([]),
    variants: z.array(z.unknown()).max(0).default([]),
    display_sizes: z.array(z.unknown()).max(0).default([]),
  }),
});

/** Diagnostic candidate only: deliberately not a ScrapedProduct or verified offer. */
export function inspectFlipkartAPIProduct(body: string, input: string) {
  const target = flipkartProductInput(input);
  const raw = readJSON(body);
  const result = realFlipkartSchema.safeParse(raw);
  if (!result.success)
    fail(
      `Flipkart real Product API fields are missing or invalid: ${result.error.issues
        .slice(0, 8)
        .map(
          (issue) =>
            `${issue.path.map((part) => (['product_results', 'title', 'brand', 'price', 'previous_price', 'main_image', 'sku', 'availability', 'ratings_reviews', 'rating', 'ratings_count', 'specifications', 'General', 'Brand', 'Model Name', 'Quantity', 'Net Quantity', 'highlights', 'variants', 'display_sizes', 'Product Highlights'].includes(String(part)) ? part : '[field]')).join('.')}:${issue.code}`,
        )
        .join('; ')}`,
    );
  const p = result.data.product_results;
  const general = p.specifications.General;
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (
    (general.Brand !== undefined && compact(p.brand) !== compact(general.Brand)) ||
    !compact(p.title).startsWith(compact(p.brand)) ||
    !compact(p.title).includes(compact(general['Model Name']))
  )
    fail('Flipkart brand/model identity fields conflict');
  if (p.previous_price !== undefined && p.previous_price < p.price)
    fail('Flipkart Product API price/MRP conflict');
  // Inspect unexpected identity hints for contradictions; never promote them to proof
  // without a documented response-side identity contract.
  const original = (raw as { product_results: Record<string, unknown> }).product_results;
  const requestedPID = new URL(target.url).searchParams.get('pid');
  for (const key of ['pid', 'product_id']) {
    if (original[key] !== undefined && original[key] !== requestedPID)
      fail('Flipkart response identity conflicts with requested PID');
  }
  for (const key of ['url', 'canonical_url']) {
    if (original[key] !== undefined) {
      if (
        typeof original[key] !== 'string' ||
        flipkartProductInput(original[key]).url !== target.url
      )
        fail('Flipkart response canonical URL conflicts with requested URL');
    }
  }
  const category = categoryFor(p.title);
  let attributes: Record<string, string>;
  try {
    attributes = selectedAttributes(p.title, general as Record<string, string>);
  } catch (error) {
    return fail(
      error instanceof Error && error.message.includes('unsupported')
        ? 'Flipkart selected quantity format is unsupported'
        : 'Flipkart selected attribute conflicts with title',
    );
  }
  const quantities = [
    general.Quantity,
    general['Net Quantity'],
    p.specifications['Product Highlights']?.Quantity,
    ...p.highlights
      .filter((s) => /^Quantity:/i.test(s))
      .map((s) => s.replace(/^Quantity:\s*/i, '')),
    ...[
      ...p.title.matchAll(
        /\b\d+(?:\.\d+)?\s*(?:ml|millilitres?|milliliters?|litres?|liters?|l)\b/gi,
      ),
    ].map((m) => m[0]),
  ]
    .filter((s): s is string => s !== undefined)
    .filter(
      (s) =>
        category === 'perfume' ||
        /^\d+(?:\.\d+)?\s*(ml|millilitres?|milliliters?|l|litres?|liters?)$/i.test(s),
    )
    .map(volume);
  if (new Set(quantities).size > 1) fail('Flipkart selected quantity fields conflict');
  if (category === 'perfume' && !quantities.length)
    fail('Flipkart selected perfume quantity is missing');
  if (quantities.length) {
    const selected = `${quantities[0]}ml`;
    if (attributes.quantity && attributes.quantity !== selected)
      fail('Flipkart selected quantity fields conflict');
    attributes.quantity = selected;
  }
  return {
    title: p.title,
    brand: p.brand,
    model: general['Model Name'],
    sku: p.sku,
    variant:
      category === 'perfume' && quantities.length
        ? `${quantities[0]}ml`
        : Object.entries(attributes)
            .sort()
            .map(([key, value]) => `${key}=${value}`)
            .join('; ') || undefined,
    category,
    currentPrice: p.price,
    originalPrice: p.previous_price,
    currency: '₹' as const,
    image: image(p.main_image),
    isOutOfStock: p.availability === 'OutOfStock',
    stars: p.ratings_reviews?.rating ?? 0,
    reviewsCount: p.ratings_reviews?.ratings_count ?? 0,
    requestedIdentityVerified: false as const,
  };
}

/** Field validation is implemented, but the supplied example has no response ID/stock. */
export function parseFlipkartAPIProduct(body: string, input: string): ScrapedProduct {
  flipkartProductInput(input);
  const raw = readJSON(body);
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'product_results' in raw &&
    typeof raw.product_results === 'object' &&
    raw.product_results !== null &&
    'sku' in raw.product_results
  ) {
    const p = inspectFlipkartAPIProduct(body, input);
    const target = flipkartProductInput(input);
    const cached = cachedFlipkartSearch(input);
    if (cached && !isVerifiedMatch({ title: cached.title }, { title: p.title }))
      fail('Flipkart cached search identity conflicts with Product response');
    // Provider URL binding is trusted, but requires independent semantic evidence
    // from the descriptive URL slug or a previously fetched Search row.
    const slug = decodeURIComponent(new URL(target.url).pathname.split('/p/')[0]);
    const requestedAttributes = titleAttributes(slug.replace(/-/g, ' '));
    const returnedAttributes = titleAttributes(`${p.title} ${p.variant ?? ''}`);
    for (const [field, value] of Object.entries(requestedAttributes))
      if (returnedAttributes[field] && value !== returnedAttributes[field])
        fail(
          field === 'quantity'
            ? 'Flipkart request URL quantity conflicts with response'
            : 'Flipkart request URL variant conflicts with response',
        );
    const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const noise = new Set(
      'perfume perfumes men women for and with long lasting notes fragrance unisex'.split(
        ' ',
      ),
    );
    const modelWords = p.model
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !noise.has(w));
    const slugWords = new Set(slug.toLowerCase().split(/[^a-z0-9]+/));
    const slugEvidence =
      compact(slug).includes(compact(p.brand)) &&
      new Set(modelWords).size >= 1 &&
      modelWords.every((w) => slugWords.has(w));
    const slugVolumes = [
      ...slug
        .replace(/-/g, ' ')
        .matchAll(
          /\b\d+(?:\.\d+)?\s*(?:ml|millilitres?|milliliters?|litres?|liters?|l)\b/gi,
        ),
    ].map((m) => `${volume(m[0])}ml`);
    if (slugVolumes.some((v) => v !== p.variant))
      fail('Flipkart request URL quantity conflicts with response');
    if (!cached && !slugEvidence)
      fail(
        'Flipkart request URL needs brand/model corroboration from its descriptive slug or cached Search result; SKU is not proof of PID',
      );
    return {
      url: target.url,
      store: 'flipkart',
      storeName: 'Flipkart',
      title: p.title,
      brand: p.brand,
      variant: p.variant,
      image: p.image,
      currency: p.currency,
      currentPrice: p.currentPrice,
      originalPrice: p.originalPrice ?? p.currentPrice,
      discountRate: p.originalPrice
        ? Math.round((1 - p.currentPrice / p.originalPrice) * 100)
        : 0,
      description: `URL-based provider response; ${cached ? 'cached Search' : 'descriptive URL'} corroboration. Response SKU ${p.sku}; response PID not independently verified.`,
      category: p.category,
      isOutOfStock: p.isOutOfStock,
      stars: p.stars,
      reviewsCount: p.reviewsCount,
    };
  }
  const result = flipkartSchema.safeParse(raw);
  if (!result.success) return fail('Flipkart Product API fields are missing or invalid');
  const p = result.data.product_results;
  image(p.main_image);
  if (p.previous_price !== undefined && p.previous_price < p.price)
    fail('Flipkart Product API price/MRP conflict');
  return fail(
    'Flipkart Product API identity and stock cannot be verified from the supplied response contract; response URL/product ID and stock schema are required',
  );
}
