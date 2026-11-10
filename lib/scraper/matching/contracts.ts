import { z } from 'zod';
export const factSchema = z.object({
  value: z.string().trim().min(1).max(200),
  field: z.string().min(1).max(120),
  scope: z.enum(['main', 'selected', 'listing', 'legacy']),
});
export type IdentityFact = z.infer<typeof factSchema>;
// BSON's driver defaults can turn an explicit undefined into null. A null in
// an OPTIONAL fact slot is absence, not a fact. Non-null input stays strict.
const optionalFact = z.preprocess(
  (value) => (value === null ? undefined : value),
  factSchema.optional(),
);
export const identitySchema = z.object({
  version: z.literal(1),
  profile: z.literal('fragrance-v1'),
  category: z.literal('perfume'),
  source: z.object({
    store: z.enum(['amazon', 'flipkart', 'myntra.com']),
    url: z.string().url(),
    kind: z.enum(['product', 'search']),
    binding: z.enum(['asin', 'seller-sku', 'url-provider', 'listing']),
  }),
  brand: factSchema,
  line: optionalFact,
  selected: z.object({
    volume: optionalFact,
    pack: optionalFact,
    concentration: optionalFact,
    formulation: optionalFact,
    edition: optionalFact,
    packageGtin: optionalFact,
  }),
  negated: z.array(z.string().max(30)).max(8),
  // Advisory MAIN Product context for the separately labelled confidence tier.
  // Strict selected facts and strict matching never derive equality from this.
  context: z.preprocess(
    (v) => (v === null ? undefined : v),
    z.object({ formulation: optionalFact, risk: optionalFact }).optional(),
  ),
  issues: z
    .array(
      z.enum([
        'name-unconfirmed',
        'volume-unconfirmed',
        'volume-conflict',
        'pack-unconfirmed',
        'concentration-ambiguous',
        'declaration-conflict',
        'brand-conflict',
        'package-identifier-invalid',
      ]),
    )
    .max(7),
});
export type CanonicalIdentity = z.infer<typeof identitySchema>;
export type MatchDecision = {
  status: 'verified' | 'mismatch' | 'insufficient';
  reason: string;
  confidence: 'category-exact' | 'none';
  profile: string;
};
export type CategoryProfile<T> = {
  id: string;
  category: string;
  compare: (a: T, b: T) => MatchDecision;
};
/** Design-only contracts; NOT registered as new production matchers. */
export const futureProfileRequirements = {
  electronics: [
    'manufacturer-model',
    'selected-colour',
    'selected-ram',
    'selected-storage',
  ],
  fashion: ['brand', 'style', 'selected-colour', 'selected-size'],
  books: ['checksum-valid-isbn', 'edition', 'language', 'binding'],
} as const;
export const brandKey = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
export function boundSource(source: CanonicalIdentity['source']) {
  try {
    const u = new URL(source.url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    const host = u.hostname.replace(/^www\./, '');
    return source.store === 'amazon'
      ? host === 'amazon.in' &&
          /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:\/|$)/i.test(u.pathname)
      : source.store === 'flipkart'
        ? host === 'flipkart.com' && /\/p\/itm[a-z0-9]+\/?$/i.test(u.pathname)
        : host === 'myntra.com' && /\/\d+\/buy\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** Shared design surface: a future profile supplies its own selected-attribute
 * schema/extractor rather than inheriting perfume or electronics requirements. */
export interface IdentityEvidence<Category extends string, Selected> {
  version: 1;
  profile: string;
  category: Category;
  source: CanonicalIdentity['source'];
  brand: IdentityFact;
  line?: IdentityFact;
  selected: Selected;
  issues: readonly string[];
}
// Design-only examples, intentionally absent from the runtime registry.
export type ElectronicsIdentityDesign = IdentityEvidence<
  'electronics',
  {
    manufacturerModel: IdentityFact;
    colour: IdentityFact;
    ram: IdentityFact;
    storage: IdentityFact;
  }
>;
export type FashionIdentityDesign = IdentityEvidence<
  'fashion',
  {
    style: IdentityFact;
    colour: IdentityFact;
    size: IdentityFact;
  }
>;
export type BookIdentityDesign = IdentityEvidence<
  'book',
  {
    isbn: IdentityFact & { validation: 'isbn-checksum' };
    edition: IdentityFact;
    language: IdentityFact;
    binding: IdentityFact;
  }
>;
