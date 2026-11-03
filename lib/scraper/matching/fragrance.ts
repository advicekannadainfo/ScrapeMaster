import { volumeMl, selectedVolumeFields } from './selected-volume';
export { volumeMl } from './selected-volume';
import { fragranceContext } from './context';
import {
  brandKey,
  boundSource,
  identitySchema,
  type CanonicalIdentity,
  type IdentityFact,
  type CategoryProfile,
  type MatchDecision,
} from './contracts';
type FragranceFacts = Omit<CanonicalIdentity, 'source'> & {
  source?: CanonicalIdentity['source'];
};
export type FragranceInput = {
  title: string;
  brand?: string;
  variant?: string;
  comparisonIdentityVerified?: boolean;
  canonicalIdentity?: unknown;
  url?: string;
  store?: string;
};
const fact = (
  value: string,
  field: string,
  scope: IdentityFact['scope'],
): IdentityFact => ({ value, field, scope });
function titleVolumes(title: string) {
  return [
    ...title
      .slice(0, 4000)
      .matchAll(/\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b/gi),
  ].map((m) => volumeMl(m[0]));
}
export function scentLine(title: string, brand: string) {
  const words = title
    .slice(0, 4000)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  let prefix = '',
    i = 0;
  while (i < words.length && prefix.length < brandKey(brand).length) prefix += words[i++];
  if (prefix !== brandKey(brand)) return;
  const generic = new Set(
    'perfume perfumes parfum fragrance fragrances edp edt edc eau de unisex men women man woman for long lasting body spray'.split(
      ' ',
    ),
  );
  // Distinctive contiguous scent words, never notes or a truncated token bag.
  while (generic.has(words[i])) i++;
  const name: string[] = [];
  for (const word of words.slice(i)) {
    if (generic.has(word) || /^\d/.test(word) || ['notes', 'with', 'by'].includes(word))
      break;
    name.push(word);
    if (name.length > 6) return;
  }
  return name.length >= 2 ? name.join(' ') : undefined;
}
const allowedFields: Record<string, string[]> = {
  amazon: [
    'product_information.Brand',
    'product_information.Item Volume',
    'product_information.Number of Items',
    'product_information.Package Size Name',
    'product_information.Fragrance Concentration',
    'main.title',
  ],
  flipkart: ['product_results.brand', ...selectedVolumeFields.flipkart, 'main.title'],
  'myntra.com': ['product_results.brand', 'selectedSeller.netQuantity', 'main.title'],
};
export function readCanonicalIdentity(value: unknown): CanonicalIdentity | undefined {
  const parsed = identitySchema.safeParse(value);
  if (!parsed.success) return;
  const e = parsed.data;
  if (
    !boundSource(e.source) ||
    brandKey(e.brand.value) !== e.brand.value ||
    e.brand.value.length < 3
  )
    return;
  const expected =
    e.source.store === 'amazon'
      ? 'asin'
      : e.source.store === 'flipkart'
        ? 'url-provider'
        : 'seller-sku';
  if (e.source.kind === 'product' && e.source.binding !== expected) return;
  if (e.source.kind === 'search' && e.source.binding !== 'listing') return;
  const facts = [e.brand, e.line, ...Object.values(e.selected)].filter(
    (f): f is IdentityFact => Boolean(f),
  );
  if (
    facts.some((f) =>
      e.source.kind === 'search'
        ? f.scope !== 'listing' || f.field !== 'listing.title'
        : !allowedFields[e.source.store].includes(f.field) ||
          !['main', 'selected'].includes(f.scope),
    )
  )
    return;
  if (e.source.kind === 'product') {
    const brandField =
      e.source.store === 'amazon' ? 'product_information.Brand' : 'product_results.brand';
    const volumeField =
      e.source.store === 'amazon'
        ? 'product_information.Item Volume'
        : e.source.store === 'flipkart'
          ? 'specifications.General.Quantity'
          : 'selectedSeller.netQuantity';
    if (
      e.brand.scope !== 'main' ||
      e.brand.field !== brandField ||
      (e.line && e.line.field !== 'main.title') ||
      (e.selected.volume &&
        (e.selected.volume.scope !== 'selected' ||
          !(
            e.source.store === 'amazon'
              ? [volumeField, 'product_information.Package Size Name']
              : e.source.store === 'flipkart'
                ? [...selectedVolumeFields.flipkart]
                : [volumeField]
          ).includes(e.selected.volume.field)))
    )
      return;
  }
  if (
    e.selected.volume &&
    (!/^\d+(?:\.\d+)?ml$/.test(e.selected.volume.value) ||
      !volumeMl(e.selected.volume.value))
  )
    return;
  if (
    e.selected.pack &&
    (e.source.store !== 'amazon' ||
      e.selected.pack.field !== 'product_information.Number of Items' ||
      e.selected.pack.scope !== 'selected' ||
      !Number.isSafeInteger(Number(e.selected.pack.value)) ||
      Number(e.selected.pack.value) <= 0 ||
      Number(e.selected.pack.value) > 1000)
  )
    return;
  return e;
}
function derive(
  title: string,
  brand: string,
  volume: IdentityFact | undefined,
  source: CanonicalIdentity['source'] | undefined,
  declared?: string,
): FragranceFacts {
  const scope = source?.kind === 'search' ? 'listing' : source ? 'main' : 'legacy';
  const titleField = source?.kind === 'search' ? 'listing.title' : 'main.title';
  const context = fragranceContext(title);
  const extra = declared ? fragranceContext(declared) : undefined;
  const concentration = [
    ...new Set([...context.concentrations, ...(extra?.concentrations ?? [])]),
  ];
  const editions = [...new Set([...context.editions, ...(extra?.editions ?? [])])].sort();
  const formulation = [
    ...new Set([...context.formulations, ...(extra?.formulations ?? [])]),
  ];
  const issues: CanonicalIdentity['issues'] = [];
  const line = scentLine(title, brand);
  if (!line || title.length > 4000) issues.push('name-unconfirmed');
  if (!volume) issues.push('volume-unconfirmed');
  if (volume && titleVolumes(title).some((v) => v !== volumeMl(volume.value)))
    issues.push('volume-conflict');
  if (
    /\b(pack of|combo|bundle|set of|refills?|testers?|samples?|gift sets?|miniatures?|\d+\s*[x×]\s*\d+\s*ml)\b/i.test(
      title,
    )
  )
    issues.push('pack-unconfirmed');
  if (context.ambiguous && !(extra?.concentrations.length === 1 && !extra.contradictions))
    issues.push('concentration-ambiguous');
  if (
    context.contradictions ||
    extra?.contradictions ||
    concentration.length > 1 ||
    formulation.length > 1
  )
    issues.push('declaration-conflict');
  const negative = [...new Set([...context.negated, ...(extra?.negated ?? [])])];
  if ([...concentration, ...formulation, ...editions].some((v) => negative.includes(v)))
    issues.push('declaration-conflict');
  const brandField =
    source?.kind === 'search'
      ? 'listing.title'
      : source?.store === 'amazon'
        ? 'product_information.Brand'
        : source
          ? 'product_results.brand'
          : 'legacy.brand';
  return {
    version: 1,
    profile: 'fragrance-v1',
    category: 'perfume',
    source,
    brand: fact(brandKey(brand), brandField, scope),
    line: line ? fact(line, titleField, scope) : undefined,
    selected: {
      volume,
      edition: editions.length ? fact(editions.join('/'), titleField, scope) : undefined,
      concentration:
        concentration.length === 1
          ? fact(
              concentration[0],
              declared && extra?.concentrations.length
                ? 'product_information.Fragrance Concentration'
                : titleField,
              scope,
            )
          : undefined,
      formulation:
        formulation.length === 1
          ? fact(
              formulation[0],
              declared && extra?.formulations.length
                ? 'product_information.Fragrance Concentration'
                : titleField,
              scope,
            )
          : undefined,
    },
    negated: negative,
    issues: [...new Set(issues)],
  };
}
/** Called only AFTER a Product adapter validates the root product, selected offer and price. */
export function mainFragranceIdentity(input: {
  title: string;
  brand?: string;
  store: string;
  url: string;
  selectedVolume?: number;
  volumeField: string;
  declaration?: string;
  pack?: unknown;
}) {
  if (
    !input.brand ||
    !/\b(perfume|parfum|fragrance)\b/i.test(input.title) ||
    !['amazon', 'flipkart', 'myntra.com'].includes(input.store)
  )
    return null;
  const store = input.store as CanonicalIdentity['source']['store'];
  const e = derive(
    input.title,
    input.brand,
    input.selectedVolume
      ? fact(`${input.selectedVolume}ml`, input.volumeField, 'selected')
      : undefined,
    {
      store,
      url: input.url,
      kind: 'product',
      binding:
        store === 'amazon'
          ? 'asin'
          : store === 'flipkart'
            ? 'url-provider'
            : 'seller-sku',
    },
    input.declaration,
  );
  if (input.pack !== undefined) {
    const value =
      typeof input.pack === 'string' && /^[1-9]\d*$/.test(input.pack)
        ? Number(input.pack)
        : typeof input.pack === 'number'
          ? input.pack
          : NaN;
    if (Number.isSafeInteger(value) && value > 0 && value <= 1000)
      e.selected.pack = fact(
        String(value),
        'product_information.Number of Items',
        'selected',
      );
    else e.issues.push('pack-unconfirmed');
  }
  return readCanonicalIdentity(e) ?? null;
}
export function independentFragrance(value: unknown) {
  const e = readCanonicalIdentity(value);
  return Boolean(
    e && e.source.kind === 'product' && !e.issues.length && e.line && e.selected.volume,
  );
}
/** Legacy/manual compatibility is not independent evidence for new saved links. */
export function fragranceIdentity(
  input: FragranceInput,
  listing = false,
): FragranceFacts | undefined {
  if (input.title.length > 4000) return;
  if (input.canonicalIdentity != null) {
    const e = readCanonicalIdentity(input.canonicalIdentity);
    if (
      !e ||
      (input.url && e.source.url !== input.url) ||
      (input.store && e.source.store !== input.store) ||
      (input.brand && brandKey(input.brand) !== e.brand.value)
    )
      return;
    const currentLine = scentLine(input.title, input.brand ?? e.brand.value);
    if (e.line && currentLine !== e.line.value) return;
    if (
      e.selected.volume &&
      titleVolumes(input.title).some((v) => v !== volumeMl(e.selected.volume!.value))
    )
      return;
    if (
      input.variant &&
      volumeMl(input.variant) &&
      e.selected.volume?.value !== `${volumeMl(input.variant)}ml`
    )
      return;
    const context = fragranceContext(input.title);
    if (
      context.contradictions ||
      context.ambiguous ||
      /\b(pack of|combo|bundle|set of|refills?|testers?|samples?|gift sets?|miniatures?)\b/i.test(
        input.title,
      )
    )
      return;
    if (
      context.negated.some(
        (v) =>
          !e.negated.includes(v) ||
          v === e.selected.concentration?.value ||
          v === e.selected.formulation?.value ||
          e.selected.edition?.value.split('/').includes(v),
      )
    )
      return;
    if (
      context.concentrations.some((v) => v !== e.selected.concentration?.value) ||
      context.formulations.some((v) => v !== e.selected.formulation?.value) ||
      context.editions.some((v) => !e.selected.edition?.value.split('/').includes(v))
    )
      return;
    return e;
  }
  if (!input.brand || input.comparisonIdentityVerified === false) return;
  const volumes = titleVolumes(input.title);
  const selected = listing
    ? volumes.length && new Set(volumes).size === 1
      ? volumes[0]
      : undefined
    : input.variant
      ? volumeMl(input.variant)
      : undefined;
  // Legacy fixtures and offers may not carry a canonical URL; never persist these as main evidence.
  const e = derive(
    input.title,
    input.brand,
    selected
      ? fact(
          `${selected}ml`,
          listing ? 'listing.title' : 'legacy.variant',
          listing ? 'listing' : 'legacy',
        )
      : undefined,
    undefined,
  );
  return e;
}
export const fragranceProfile: CategoryProfile<FragranceFacts> = {
  id: 'fragrance-v1',
  category: 'perfume',
  compare(a, b): MatchDecision {
    const result = (status: MatchDecision['status'], reason: string): MatchDecision => ({
      status,
      reason,
      confidence: status === 'verified' ? 'category-exact' : 'none',
      profile: 'fragrance-v1',
    });
    if (a.brand.value !== b.brand.value) return result('mismatch', 'brand-conflict');
    if (a.line && b.line && a.line.value !== b.line.value)
      return result('mismatch', 'scent-conflict');
    for (const key of [
      'volume',
      'pack',
      'concentration',
      'formulation',
      'edition',
    ] as const) {
      const x = a.selected[key]?.value,
        y = b.selected[key]?.value;
      if (x && y && x !== y) return result('mismatch', `${key}-conflict`);
      if (key !== 'volume' && Boolean(x) !== Boolean(y))
        return result('insufficient', `${key}-unconfirmed`);
    }
    if (
      a.negated.some((v) =>
        [
          b.selected.concentration?.value,
          b.selected.formulation?.value,
          ...(b.selected.edition?.value.split('/') ?? []),
        ].includes(v),
      ) ||
      b.negated.some((v) =>
        [
          a.selected.concentration?.value,
          a.selected.formulation?.value,
          ...(a.selected.edition?.value.split('/') ?? []),
        ].includes(v),
      )
    )
      return result('mismatch', 'negated-declaration');
    if (
      (a.negated.length || b.negated.length) &&
      !a.selected.concentration &&
      !b.selected.concentration
    )
      return result('insufficient', 'negated-selection-unconfirmed');
    if (a.issues.length || b.issues.length)
      return result('insufficient', a.issues[0] ?? b.issues[0]);
    return a.line && b.line && a.selected.volume && b.selected.volume
      ? result('verified', 'independent-category-evidence')
      : result('insufficient', 'selected-evidence-missing');
  },
};
export function fragranceDecision(a: FragranceInput, b: FragranceInput): MatchDecision {
  const x = fragranceIdentity(a),
    y = fragranceIdentity(b);
  return x && y
    ? fragranceProfile.compare(x, y)
    : {
        status: 'insufficient',
        reason: 'selected-evidence-missing',
        confidence: 'none',
        profile: 'fragrance-v1',
      };
}

export function searchFragranceIdentity(input: FragranceInput, brand: string) {
  if (
    !input.store ||
    !['amazon', 'flipkart', 'myntra.com'].includes(input.store) ||
    !input.url ||
    input.comparisonIdentityVerified === false
  )
    return undefined;
  const volumes = titleVolumes(input.title);
  const selected = volumes.length && new Set(volumes).size === 1 ? volumes[0] : undefined;
  const e = derive(
    input.title,
    brand,
    selected ? fact(`${selected}ml`, 'listing.title', 'listing') : undefined,
    {
      store: input.store as CanonicalIdentity['source']['store'],
      url: input.url,
      kind: 'search',
      binding: 'listing',
    },
  );
  return readCanonicalIdentity(e);
}
