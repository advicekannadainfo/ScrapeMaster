import { z } from 'zod';
import { categoryFor, normalizedValue } from './product-identity';
const fact = z.object({
  value: z.string().trim().min(1).max(200),
  field: z
    .string()
    .regex(
      /^(?:product_information|specifications\.General|selectedSeller\.netQuantity)\.[A-Za-z ]{1,60}$/,
    ),
});
const schema = z.object({
  version: z.literal(1),
  store: z.enum(['amazon', 'flipkart', 'myntra.com']),
  url: z.string().url(),
  observedAt: z.string().datetime(),
  price: z.number().finite().positive(),
  currency: z.literal('₹'),
  inStock: z.boolean(),
  category: z.string(),
  brand: fact,
  mpn: fact.optional(),
  gtin: fact.optional(),
  selected: z.record(
    z.enum([
      'colour',
      'quantity',
      'pack',
      'memory',
      'ram',
      'disk',
      'cpu',
      'fashionSize',
      'concentration',
      'capacity',
    ]),
    fact,
  ),
});
export type ExactEvidence = z.infer<typeof schema>;
export const SAVED_PRODUCT_TTL_MS = 10 * 60_000;
export function readExactEvidence(value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return undefined;
  const e = parsed.data;
  const prefix =
    e.store === 'amazon'
      ? 'product_information.'
      : e.store === 'flipkart'
        ? 'specifications.General.'
        : undefined;
  if (
    !prefix ||
    [e.brand, e.mpn, e.gtin, ...Object.values(e.selected)].some(
      (f) => f && !f.field.startsWith(prefix),
    )
  )
    return undefined;
  const fields: Record<string, string[]> = {
    colour: ['Color', 'Colour'],
    quantity: ['Item Volume', 'Quantity', 'Net Quantity'],
    pack: ['Number of Items', 'Pack Size'],
    memory: ['Storage', 'RAM'],
    ram: ['RAM'],
    disk: ['Storage'],
    cpu: ['Processor', 'Processor Name'],
    fashionSize: ['Size'],
    concentration: ['Fragrance Concentration'],
    capacity: ['Capacity'],
  };
  if (
    Object.entries(e.selected).some(
      ([key, f]) => f && !fields[key]?.some((label) => f.field === prefix + label),
    )
  )
    return undefined;
  if (
    !/\.Brand$/.test(e.brand.field) ||
    (e.mpn && !/\.(?:Manufacturer Part Number|Model Number)$/.test(e.mpn.field)) ||
    (e.gtin && !/\.(?:GTIN|EAN|UPC)$/.test(e.gtin.field))
  )
    return undefined;
  if (
    [e.brand, e.mpn, e.gtin, ...Object.values(e.selected)].some(
      (f) => f && /^(?:unknown|unspecified|n\/a|default|not available)$/i.test(f.value),
    )
  )
    return undefined;
  if (e.selected.pack && !/^[1-9]\d*$/.test(e.selected.pack.value)) return undefined;
  for (const field of ['quantity', 'capacity', 'ram', 'disk'] as const) {
    const value = e.selected[field];
    if (!value) continue;
    const normalized = normalizedValue(value.value);
    const units =
      field === 'ram' || field === 'disk'
        ? /^(\d+(?:\.\d+)?)(?:gb|tb)$/
        : /^(\d+(?:\.\d+)?)(?:ml|g)$/;
    const measured = units.exec(normalized);
    if (!measured || Number(measured[1]) <= 0) return undefined;
  }
  return e;
}
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function gtin(value: string) {
  const digits = value.replace(/[ -]/g, '');
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return;
  const total = [...digits]
    .reverse()
    .reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0);
  return total % 10 === 0 ? digits.padStart(14, '0') : undefined;
}
type Attribute = keyof ExactEvidence['selected'];
const required: Record<string, Attribute[]> = {
  earbuds: ['colour', 'pack'],
  phone: ['colour', 'ram', 'disk', 'pack'],
  laptop: ['colour', 'ram', 'disk', 'cpu', 'pack'],
  fashion: ['colour', 'fashionSize', 'pack'],
  perfume: ['quantity', 'concentration', 'pack'],
  grocery: ['quantity', 'pack'],
  appliance: ['capacity', 'colour', 'pack'],
};
export function sufficientExactEvidence(value: unknown) {
  const e = readExactEvidence(value);
  return Boolean(
    e &&
    required[e.category] &&
    (!e.gtin || gtin(e.gtin.value)) &&
    (e.mpn || (e.gtin && gtin(e.gtin.value))) &&
    required[e.category].every((k) => e.selected[k]),
  );
}
export function exactMatch(
  a: unknown,
  b: unknown,
): 'verified' | 'mismatch' | 'insufficient' {
  const x = readExactEvidence(a),
    y = readExactEvidence(b);
  if (!x || !y) return 'insufficient';
  if ((x.gtin && !gtin(x.gtin.value)) || (y.gtin && !gtin(y.gtin.value)))
    return 'mismatch';
  if (key(x.brand.value) !== key(y.brand.value) || x.category !== y.category)
    return 'mismatch';
  for (const id of ['mpn', 'gtin'] as const) {
    if (x[id] && y[id]) {
      const norm = id === 'gtin' ? gtin : (s: string) => s.trim().toLowerCase();
      if (!norm(x[id]!.value) || norm(x[id]!.value) !== norm(y[id]!.value))
        return 'mismatch';
    }
  }
  for (const field of new Set([
    ...Object.keys(x.selected),
    ...Object.keys(y.selected),
  ] as Attribute[])) {
    if (
      x.selected[field] &&
      y.selected[field] &&
      normalizedValue(x.selected[field].value) !==
        normalizedValue(y.selected[field].value)
    )
      return 'mismatch';
    if (!x.selected[field] || !y.selected[field]) return 'insufficient';
  }
  const identifier =
    (x.mpn &&
      y.mpn &&
      x.mpn.value.trim().toLowerCase() === y.mpn.value.trim().toLowerCase()) ||
    (x.gtin && y.gtin && gtin(x.gtin.value) && gtin(x.gtin.value) === gtin(y.gtin.value));
  return identifier && sufficientExactEvidence(x) && sufficientExactEvidence(y)
    ? 'verified'
    : 'insufficient';
}
/** Adapter-fed MAIN selected fields only. Unsupported fields simply supply no evidence. */
export function mainEvidence(
  p: {
    store: string;
    url: string;
    title: string;
    brand?: string;
    currentPrice: number;
    currency: string;
    isOutOfStock: boolean;
  },
  fields: Record<string, unknown>,
  prefix: 'product_information' | 'specifications.General',
  retailerIds: string[] = [],
) {
  if (!p.brand) return undefined;
  const get = (name: string) =>
    typeof fields[name] === 'string' && String(fields[name]).trim()
      ? { value: String(fields[name]).trim(), field: `${prefix}.${name}` }
      : undefined;
  const brand = get('Brand');
  if (!brand || key(brand.value) !== key(p.brand)) return undefined;
  const selected: Record<string, z.infer<typeof fact>> = {};
  const labels: Record<string, string> = {
    Color: 'colour',
    Colour: 'colour',
    Size: 'fashionSize',
    RAM: 'ram',
    Storage: 'disk',
    Capacity: 'capacity',
    'Item Volume': 'quantity',
    'Fragrance Concentration': 'concentration',
    'Number of Items': 'pack',
  };
  for (const [label, attribute] of Object.entries(labels)) {
    const value = get(label);
    if (value) selected[attribute] = value;
  }
  // Two conflicting aliases must not silently overwrite each other.
  if (
    get('Color') &&
    get('Colour') &&
    normalizedValue(get('Color')!.value) !== normalizedValue(get('Colour')!.value)
  )
    return undefined;
  let mpn = get('Manufacturer Part Number') ?? get('Model Number');
  if (mpn && retailerIds.some((id) => key(id) === key(mpn!.value))) mpn = undefined;
  const e = {
    version: 1,
    store: p.store,
    url: p.url,
    observedAt: new Date().toISOString(),
    price: p.currentPrice,
    currency: p.currency,
    inStock: !p.isOutOfStock,
    category: categoryFor(p.title),
    brand,
    mpn,
    selected,
  };
  return readExactEvidence(e);
}
export function freshSavedPrice(
  record: {
    url: string;
    store: string;
    currentPrice: number;
    currency: string;
    isOutOfStock?: boolean;
    exactEvidence?: unknown;
  },
  now = Date.now(),
) {
  const e = readExactEvidence(record.exactEvidence);
  if (!e) return false;
  const age = now - Date.parse(e.observedAt);
  try {
    const url = new URL(record.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
      return false;
    const host = url.hostname.replace(/^www\./, '');
    if (
      (e.store === 'amazon' && host !== 'amazon.in') ||
      (e.store === 'flipkart' && host !== 'flipkart.com') ||
      (e.store === 'myntra.com' && host !== 'myntra.com')
    )
      return false;
  } catch {
    return false;
  }
  return (
    age >= 0 &&
    age <= SAVED_PRODUCT_TTL_MS &&
    e.url === record.url &&
    e.store === record.store &&
    e.price === record.currentPrice &&
    e.currency === record.currency &&
    e.inStock &&
    record.isOutOfStock === false
  );
}
