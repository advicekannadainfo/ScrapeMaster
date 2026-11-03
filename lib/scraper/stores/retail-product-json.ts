import { mainFragranceIdentity, volumeMl } from '../matching/fragrance';
import { observeProduct } from '../matching/observations';
import { mainEvidence } from '../exact-evidence';
import { mainProductDescription } from '@/lib/product-presentation';
import { productValidationDiagnostic } from '../product-validation-diagnostic';
import { z } from 'zod';
import { ScrapeError } from '../errors';
import { amazonIndiaProductInput, flipkartProductInput } from '../retail-product-input';
import type { ScrapedProduct } from '@/types';
import { cachedFlipkartSearch } from '../flipkart-evidence';
import { categoryFor, selectedAttributes, titleAttributes } from '../product-identity';
import { comparisonSearchQuery } from '@/lib/verified-offers';

const text = z.string().trim().min(1);
const positive = z.number().finite().positive();
const amazonSchema = z.object({
  title: text,
  description: z.unknown().optional(),
  feature_bullets: z.unknown().optional(),
  main_title: text.optional(),
  product_information: z.object({
    ASIN: z.string().regex(/^[a-z0-9]{10}$/i),
    Brand: text.optional().nullable(),
    'Item Volume': text.optional(),
    'Package Size Name': text.optional(),
  }),
  extracted_price: positive,
  price_symbol: z.literal('₹').optional(),
  price: text.optional(),
  main_image: z.string().url(),
  availability_status: text.optional(),
  purchase_options: z
    .object({
      single_offer: z
        .object({ extracted_price: positive.optional(), stock: text.optional() })
        .optional(),
    })
    .optional(),
  extracted_average_rating: z.number().min(0).max(5).optional().nullable(),
  extracted_total_reviews: z.number().int().nonnegative().optional().nullable(),
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
  if (!result.success)
    return fail(
      `Amazon Product API fields are missing or invalid: ${productValidationDiagnostic(result.error, ['title', 'main_title', 'product_information', 'ASIN', 'Brand', 'Item Volume', 'Package Size Name', 'extracted_price', 'price_symbol', 'price', 'main_image', 'availability_status', 'purchase_options', 'single_offer', 'stock', 'extracted_average_rating', 'extracted_total_reviews'])}`,
    );
  const p = result.data;
  if (p.product_information.ASIN.toUpperCase() !== target.asin)
    fail('Amazon Product API returned a different ASIN');
  const single = p.purchase_options?.single_offer;
  if (
    single?.extracted_price !== undefined &&
    p.extracted_price !== single.extracted_price
  )
    fail('Amazon selected-offer price conflicts with product price');
  const printed =
    /^₹\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?: with \d+(?:\.\d+)? percent savings)?$/.exec(
      p.price ?? '',
    );
  if (p.price && /^(?:[$€£]|USD\b|EUR\b|GBP\b)/i.test(p.price))
    fail('Amazon main-price currency conflicts with INR');
  if (printed && Number(printed[1].replace(/,/g, '')) !== p.extracted_price)
    fail('Amazon main-price evidence has conflicting amounts');
  if (!p.price_symbol && !printed)
    fail('Amazon price_symbol: INR main-price evidence missing or conflicting');
  const availability = p.availability_status ?? single?.stock;
  if (!availability)
    fail('Amazon availability_status: main-product stock evidence missing');
  const available = stock(availability);
  if (single?.stock !== undefined && available !== stock(single.stock))
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
  if (
    p.product_information.Brand &&
    !compact(title).startsWith(compact(p.product_information.Brand))
  )
    title = `${p.product_information.Brand} ${title}`;
  const chosenTitleHasVolume =
    /\b\d+(?:\.\d+)?\s*(?:millilitres?|milliliters?|ml|litres?|liters?|l)\b/i.test(title);
  if (volumes.length && !chosenTitleHasVolume) title += ` ${volumes[0]}ml`;
  const exactEvidence = mainEvidence(
    {
      store: 'amazon',
      url: target.url,
      title,
      brand: p.product_information.Brand ?? undefined,
      currentPrice: p.extracted_price,
      currency: '₹',
      isOutOfStock: !available,
    },
    (readJSON(body) as { product_information: Record<string, unknown> })
      .product_information,
    'product_information',
    [target.asin],
  );
  const canonicalIdentity = mainFragranceIdentity({
    title: p.title,
    brand: p.product_information.Brand ?? undefined,
    store: 'amazon',
    url: target.url,
    selectedVolume: volumes[0],
    volumeField: p.product_information['Item Volume']
      ? 'product_information.Item Volume'
      : 'product_information.Package Size Name',
    pack: (readJSON(body) as { product_information: Record<string, unknown> })
      .product_information['Number of Items'],
    declaration:
      typeof (readJSON(body) as { product_information: Record<string, unknown> })
        .product_information['Fragrance Concentration'] === 'string'
        ? String(
            (readJSON(body) as { product_information: Record<string, unknown> })
              .product_information['Fragrance Concentration'],
          )
        : undefined,
  });
  return {
    canonicalIdentity,
    priceObservation: observeProduct(
      canonicalIdentity,
      p.extracted_price,
      '₹',
      !available,
    ),
    exactEvidence: exactEvidence ?? null,
    url: target.url,
    store: 'amazon',
    storeName: 'Amazon',
    storeProductId: target.asin,
    brand: p.product_information.Brand ?? undefined,
    comparisonIdentityVerified: Boolean(p.product_information.Brand),
    variant: volumes.length ? `${volumes[0]}ml` : undefined,
    title,
    image: image(p.main_image),
    currency: '₹',
    currentPrice: p.extracted_price,
    originalPrice: p.extracted_price,
    discountRate: 0,
    description: mainProductDescription(p.description, p.feature_bullets),
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
export const MAX_FLIPKART_VARIANTS = 50;

/** Structural diagnostics only. Raw provider keys/values are never logged. */
function logMissingFlipkartModel(raw: unknown) {
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const type = (value: unknown) =>
    value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const root = object(object(raw).product_results);
  const specs = object(root.specifications);
  const groups: Record<string, string> = {
    general: 'General',
    producthighlights: 'Product Highlights',
    technicaldetails: 'Technical Details',
    productdetails: 'Product Details',
    audiofeatures: 'Audio Features',
    connectivityfeatures: 'Connectivity Features',
    dimensions: 'Dimensions',
    warranty: 'Warranty',
    features: 'Features',
    technicalspecifications: 'Technical Specifications',
  };
  const models: Record<string, string> = {
    modelname: 'Model Name',
    modelnumber: 'Model Number',
    modelno: 'Model No',
    modelid: 'Model ID',
    productname: 'Product Name',
    productmodel: 'Product Model',
    series: 'Series',
    seriesname: 'Series Name',
    model: 'Model',
    name: 'Name',
  };
  const key = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
  const entries = Object.entries(specs);
  const specificationGroups = entries.slice(0, 12).map(([name, value]) => ({
    group: Object.hasOwn(groups, key(name)) ? groups[key(name)] : '[redacted group]',
    type: type(value),
    modelFields: Object.entries(object(value))
      .slice(0, 40)
      .filter(([field]) => Object.hasOwn(models, key(field)))
      .slice(0, 10)
      .map(([field, item]) => ({ field: models[key(field)], type: type(item) })),
  }));
  const general = object(specs.General);
  const alternativeMainIdentity = [
    'model',
    'model_name',
    'model_number',
    'model_id',
    'product_id',
    'pid',
    'sku',
    'url',
    'canonical_url',
    'brand',
    'title',
  ].map((field) => ({
    field,
    present: Object.hasOwn(root, field),
    type: type(root[field]),
  }));
  console.warn('[flipkart] Missing Model Name structural diagnostic', {
    specificationGroups,
    groupsTruncated: entries.length > 12,
    fieldInspectionLimit: 40,
    selectedColourEvidence: {
      titleHasRecognizedColour:
        typeof root.title === 'string' && Boolean(titleAttributes(root.title).colour),
      general: ['Color', 'Colour'].map((field) => ({
        field,
        present: Object.hasOwn(general, field),
        type: type(general[field]),
      })),
    },
    alternativeMainIdentity,
  });
}

/** Only the documented string contract is established. Do not unwrap unknown
 * arrays/objects or substitute title/URL words for missing response-side model. */
function flipkartModel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  const shape =
    value === undefined
      ? 'missing'
      : value === null
        ? 'null'
        : Array.isArray(value)
          ? `array; length=${value.length}; elementTypes=${[...new Set(value.slice(0, 5).map((entry) => (entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry)))].join(',')}`
          : typeof value === 'string'
            ? 'empty-string'
            : typeof value;
  return fail(
    `Flipkart product_results.specifications.General.Model Name: unsupported model representation (observed=${shape}); nonempty string evidence required`,
  );
}
const realFlipkartSchema = z.object({
  product_results: z.object({
    title: text,
    description: z.unknown().optional(),
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
    specifications: z
      .object({
        General: z
          .object({
            Brand: text.optional(),
            'Model Name': z.unknown(),
            Quantity: text.optional(),
            'Net Quantity': text.optional(),
          })
          .catchall(z.unknown())
          .default({}),
        'Product Highlights': z.object({ Quantity: text }).optional(),
      })
      .default({}),
    highlights: z.unknown().optional(),
    // Alternative listings are a bounded opaque catalog, never selected evidence.
    variants: z.array(z.unknown()).max(MAX_FLIPKART_VARIANTS).default([]),
    display_sizes: z.array(z.unknown()).max(MAX_FLIPKART_VARIANTS).default([]),
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
  if (p.specifications.General['Model Name'] === undefined) logMissingFlipkartModel(raw);
  const model = flipkartModel(p.specifications.General['Model Name']);
  const general = { ...p.specifications.General, 'Model Name': model };
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (
    (general.Brand !== undefined && compact(p.brand) !== compact(general.Brand)) ||
    !compact(p.title).startsWith(compact(p.brand)) ||
    (model !== undefined && !compact(p.title).includes(compact(model)))
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
    const selected = Object.fromEntries(
      Object.entries(general).filter(([key]) =>
        [
          'Brand',
          'Color',
          'Colour',
          'Quantity',
          'Net Quantity',
          'Size',
          'Storage',
          'Capacity',
          'RAM',
          'Processor',
          'Processor Name',
          'Model Number',
          'Pack Size',
          'ISBN',
          'ISBN-10',
          'ISBN-13',
          'Edition',
          'Language',
        ].includes(key),
      ),
    );
    if (Object.values(selected).some((value) => typeof value !== 'string'))
      fail('Flipkart selected specification representation is unsupported');
    attributes = selectedAttributes(p.title, selected as Record<string, string>);
  } catch (error) {
    return fail(
      error instanceof Error && error.message.includes('unsupported')
        ? 'Flipkart selected quantity format is unsupported'
        : 'Flipkart selected attribute conflicts with title',
    );
  }
  // Alternatives do not invalidate a URL-bound root price. Missing selected
  // colour only downgrades comparison confidence; explicit conflicts above reject.
  const colours = [
    (general as Record<string, string>).Color,
    (general as Record<string, string>).Colour,
  ].filter((value): value is string => value !== undefined);
  const printedColour = titleAttributes(p.title).colour;
  const catalogSelectionCorroborated =
    !(p.variants.length || p.display_sizes.length) ||
    Boolean(
      printedColour &&
      !printedColour.includes('/') &&
      colours.length &&
      colours.every((value) => value.trim().toLowerCase() === printedColour),
    );
  const quantities = [
    general.Quantity,
    general['Net Quantity'],
    p.specifications['Product Highlights']?.Quantity,
    ...(Array.isArray(p.highlights)
      ? p.highlights.filter((value): value is string => typeof value === 'string')
      : []
    )
      .filter((s) =>
        /^Quantity:\s*\d+(?:\.\d+)?\s*(?:ml|millilitres?|milliliters?|l|litres?|liters?)$/i.test(
          s.trim(),
        ),
      )
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
    description: mainProductDescription(p.description, p.highlights),
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
    comparisonIdentityVerified: model !== undefined && catalogSelectionCorroborated,
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
    if (cached) {
      // Search is corroboration for tracking, not a selected-colour requirement.
      const tokens = (title: string) =>
        new Set(
          comparisonSearchQuery(title)
            .split(' ')
            .filter((word) => !titleAttributes(word).colour),
        );
      const a = tokens(cached.title),
        b = tokens(p.title);
      const cachedAttributes = titleAttributes(cached.title);
      const rootAttributes = titleAttributes(`${p.title} ${p.variant ?? ''}`);
      if (
        a.size !== b.size ||
        [...a].some((word) => !b.has(word)) ||
        Object.entries(cachedAttributes).some(
          ([key, value]) => rootAttributes[key] && rootAttributes[key] !== value,
        )
      )
        fail('Flipkart cached search identity conflicts with Product response');
    }
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
    const modelWords = (p.model ?? '')
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
    const titleWords = comparisonSearchQuery(p.title)
      .split(' ')
      .filter(
        (word) =>
          !comparisonSearchQuery(p.brand).split(' ').includes(word) &&
          !titleAttributes(word).colour,
      );
    const titleContext =
      compact(slug).includes(compact(p.brand)) &&
      new Set(titleWords).size >= 2 &&
      titleWords.every((word) => slugWords.has(word));
    const original = (readJSON(body) as { product_results: Record<string, unknown> })
      .product_results;
    const responseBound = ['pid', 'product_id', 'url', 'canonical_url'].some(
      (key) => original[key] !== undefined,
    );
    if (!p.model && !cached && !titleContext && !responseBound)
      fail(
        'Flipkart tracking identity is ambiguous: missing Model Name requires main-product URL/title or explicit response identity corroboration; observed=missing; nonempty string evidence required for model verification',
      );
    if (p.model && !cached && !slugEvidence)
      fail(
        'Flipkart request URL needs brand/model corroboration from its descriptive slug or cached Search result; SKU is not proof of PID',
      );
    const exactEvidence = mainEvidence(
      {
        store: 'flipkart',
        url: target.url,
        title: p.title,
        brand: p.brand,
        currentPrice: p.currentPrice,
        currency: p.currency,
        isOutOfStock: p.isOutOfStock,
      },
      (original.specifications as { General?: Record<string, unknown> } | undefined)
        ?.General ?? {},
      'specifications.General',
      [target.pid ?? '', p.sku],
    );
    const general = (
      original.specifications as { General?: Record<string, unknown> } | undefined
    )?.General;
    const canonicalIdentity = mainFragranceIdentity({
      title: p.title,
      brand: p.brand,
      store: 'flipkart',
      url: target.url,
      selectedVolume:
        typeof general?.Quantity === 'string' ? volumeMl(general.Quantity) : undefined,
      volumeField: 'specifications.General.Quantity',
    });
    return {
      canonicalIdentity,
      priceObservation: observeProduct(
        canonicalIdentity,
        p.currentPrice,
        p.currency,
        p.isOutOfStock,
      ),
      exactEvidence: exactEvidence ?? null,
      url: target.url,
      store: 'flipkart',
      storeName: 'Flipkart',
      title: p.title,
      brand: p.brand,
      comparisonIdentityVerified: p.comparisonIdentityVerified,
      variant: p.variant,
      image: p.image,
      currency: p.currency,
      currentPrice: p.currentPrice,
      originalPrice: p.originalPrice ?? p.currentPrice,
      discountRate: p.originalPrice
        ? Math.round((1 - p.currentPrice / p.originalPrice) * 100)
        : 0,
      description: p.description,
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
