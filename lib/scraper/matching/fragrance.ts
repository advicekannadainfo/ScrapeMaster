import { volumeMl, selectedVolumeFields } from './selected-volume';
export { volumeMl } from './selected-volume';
import { fragranceContext } from './context';
import { normalizedGTIN } from '../exact-evidence';
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
    'product_information.GTIN',
    'product_information.EAN',
    'product_information.UPC',
  ],
  flipkart: [
    'product_results.brand',
    ...selectedVolumeFields.flipkart,
    'main.title',
    'specifications.General.GTIN',
    'specifications.General.EAN',
    'specifications.General.UPC',
    'specifications.General.Number of Items',
    'specifications.General.Pack Size',
    'specifications.General.Fragrance Concentration',
  ],
  'myntra.com': ['product_results.brand', 'selectedSeller.netQuantity', 'main.title'],
};
export type CanonicalValidationFailure = {
  code: string;
  path: string;
  observedType?: string;
};
const diagnosticPaths = new Set([
  '$',
  'version',
  'profile',
  'category',
  'source',
  'source.store',
  'source.url',
  'source.kind',
  'source.binding',
  'brand',
  'line',
  'selected',
  'negated',
  'negated.[]',
  'issues',
  'issues.[]',
  ...[
    'brand',
    'line',
    ...['volume', 'pack', 'concentration', 'formulation', 'edition', 'packageGtin'].map(
      (key) => `selected.${key}`,
    ),
  ].flatMap((path) => [
    path,
    ...['value', 'field', 'scope'].map((key) => `${path}.${key}`),
  ]),
]);
export function canonicalValidationFailures(
  value: unknown,
): CanonicalValidationFailure[] {
  const failures: CanonicalValidationFailure[] = [];
  readCanonicalIdentity(value, (failure) => {
    if (failures.length < 8) failures.push(failure);
  });
  return failures;
}
export function readCanonicalIdentity(
  value: unknown,
  onFailure?: (failure: CanonicalValidationFailure) => void,
): CanonicalIdentity | undefined {
  const reject = (code: string, path: string) => {
    onFailure?.({ code, path });
    return undefined;
  };
  const parsed = identitySchema.safeParse(value);
  if (!parsed.success) {
    const allowedCodes = new Set([
      'invalid_type',
      'invalid_literal',
      'invalid_enum_value',
      'invalid_string',
      'too_small',
      'too_big',
      'custom',
    ]);
    for (const issue of parsed.error.issues.slice(0, 8)) {
      const path =
        issue.path.map((p) => (typeof p === 'number' ? '[]' : p)).join('.') || '$';
      onFailure?.({
        code: `schema.${allowedCodes.has(issue.code) ? issue.code : 'invalid'}`,
        path: diagnosticPaths.has(path) ? path : '$',
        ...(issue.code === 'invalid_type' &&
        [
          'null',
          'undefined',
          'string',
          'number',
          'boolean',
          'object',
          'array',
          'date',
          'nan',
          'bigint',
          'symbol',
          'function',
        ].includes(issue.received)
          ? { observedType: issue.received }
          : {}),
      });
    }
    return;
  }
  const e = parsed.data;
  if (!boundSource(e.source)) return reject('source-url-unbound', 'source.url');
  if (brandKey(e.brand.value) !== e.brand.value)
    return reject('brand-key-not-canonical', 'brand.value');
  if (e.brand.value.length < 3) return reject('brand-key-too-short', 'brand.value');
  const expected =
    e.source.store === 'amazon'
      ? 'asin'
      : e.source.store === 'flipkart'
        ? 'url-provider'
        : 'seller-sku';
  if (e.source.kind === 'product' && e.source.binding !== expected)
    return reject('product-binding-invalid', 'source.binding');
  if (e.source.kind === 'search' && e.source.binding !== 'listing')
    return reject('listing-binding-invalid', 'source.binding');
  const facts: [string, IdentityFact | undefined][] = [
    ['brand', e.brand],
    ['line', e.line],
    ...Object.entries(e.selected).map(
      ([key, f]) => [`selected.${key}`, f] as [string, IdentityFact | undefined],
    ),
  ];
  for (const [path, f] of facts) {
    if (!f) continue;
    if (e.source.kind === 'search') {
      if (f.scope !== 'listing')
        return reject('listing-fact-scope-invalid', `${path}.scope`);
      if (f.field !== 'listing.title')
        return reject('listing-fact-field-invalid', `${path}.field`);
    } else {
      if (!allowedFields[e.source.store].includes(f.field))
        return reject('product-fact-field-disallowed', `${path}.field`);
      if (!['main', 'selected'].includes(f.scope))
        return reject('product-fact-scope-invalid', `${path}.scope`);
    }
  }
  const descriptorValues = {
    concentration: ['edp', 'edt', 'edc', 'extrait'],
    formulation: ['perfume-oil', 'body-mist', 'body-spray', 'deodorant', 'attar'],
    edition: ['intense', 'elixir', 'pour-homme', 'pour-femme', 'for-him', 'for-her'],
  } as const;
  for (const slot of ['concentration', 'formulation', 'edition'] as const) {
    const f = e.selected[slot];
    if (!f) continue;
    const fieldAllowed =
      e.source.kind === 'search'
        ? f.field === 'listing.title'
        : f.field === 'main.title' ||
          (slot !== 'edition' &&
            ((e.source.store === 'amazon' &&
              f.field === 'product_information.Fragrance Concentration') ||
              (e.source.store === 'flipkart' &&
                f.field === 'specifications.General.Fragrance Concentration')));
    if (!fieldAllowed)
      return reject('descriptor-field-invalid', `selected.${slot}.field`);
    if (f.scope !== (e.source.kind === 'search' ? 'listing' : 'main'))
      return reject('descriptor-scope-invalid', `selected.${slot}.scope`);
    const values = slot === 'edition' ? f.value.split('/') : [f.value];
    if (
      values.some((v) => !(descriptorValues[slot] as readonly string[]).includes(v)) ||
      [...new Set(values)].sort().join('/') !== f.value
    )
      return reject(`${slot}-value-invalid`, `selected.${slot}.value`);
  }
  const declarationValues = new Set<string>(Object.values(descriptorValues).flat());
  if (e.negated.some((v) => !declarationValues.has(v)))
    return reject('negated-value-invalid', 'negated');
  if (e.source.kind === 'product') {
    const brandField =
      e.source.store === 'amazon' ? 'product_information.Brand' : 'product_results.brand';
    const volumeFields =
      e.source.store === 'amazon'
        ? ['product_information.Item Volume', 'product_information.Package Size Name']
        : e.source.store === 'flipkart'
          ? [...selectedVolumeFields.flipkart]
          : ['selectedSeller.netQuantity'];
    if (e.brand.scope !== 'main') return reject('brand-scope-invalid', 'brand.scope');
    if (e.brand.field !== brandField) return reject('brand-field-invalid', 'brand.field');
    if (e.line && e.line.field !== 'main.title')
      return reject('line-field-invalid', 'line.field');
    if (e.line && e.line.scope !== 'main')
      return reject('line-scope-invalid', 'line.scope');
    if (e.selected.volume) {
      if (e.selected.volume.scope !== 'selected')
        return reject('volume-scope-invalid', 'selected.volume.scope');
      if (!volumeFields.includes(e.selected.volume.field))
        return reject('volume-field-invalid', 'selected.volume.field');
    }
  }
  if (
    e.selected.volume &&
    (!/^\d+(?:\.\d+)?ml$/.test(e.selected.volume.value) ||
      !volumeMl(e.selected.volume.value))
  )
    return reject('volume-value-invalid', 'selected.volume.value');
  if (e.selected.pack) {
    const pack = e.selected.pack;
    if (!['amazon', 'flipkart'].includes(e.source.store))
      return reject('pack-store-unsupported', 'source.store');
    const fields =
      e.source.store === 'amazon'
        ? ['product_information.Number of Items']
        : ['specifications.General.Number of Items', 'specifications.General.Pack Size'];
    if (!fields.includes(pack.field))
      return reject('pack-field-invalid', 'selected.pack.field');
    if (pack.scope !== 'selected')
      return reject('pack-scope-invalid', 'selected.pack.scope');
    if (
      !Number.isSafeInteger(Number(pack.value)) ||
      Number(pack.value) <= 0 ||
      Number(pack.value) > 1000
    )
      return reject('pack-value-invalid', 'selected.pack.value');
  }
  if (e.selected.packageGtin) {
    const id = e.selected.packageGtin;
    const prefix =
      e.source.store === 'amazon' ? 'product_information.' : 'specifications.General.';
    if (e.source.kind !== 'product' || !['amazon', 'flipkart'].includes(e.source.store))
      return reject('package-identifier-source-invalid', 'selected.packageGtin');
    if (!['GTIN', 'EAN', 'UPC'].some((field) => id.field === prefix + field))
      return reject('package-identifier-field-invalid', 'selected.packageGtin.field');
    if (id.scope !== 'selected')
      return reject('package-identifier-scope-invalid', 'selected.packageGtin.scope');
    if (/^0+$/.test(id.value) || normalizedGTIN(id.value) !== id.value)
      return reject('package-identifier-value-invalid', 'selected.packageGtin.value');
  }
  // Avoid regenerating BSON null placeholders on all future persistence paths.
  // Do not mutate the stored input, invent facts or default the selected object.
  const compact = {
    ...e,
    selected: Object.fromEntries(
      Object.entries(e.selected).filter(([, fact]) => fact !== undefined),
    ),
  } as CanonicalIdentity;
  if (compact.line === undefined) delete compact.line;
  return compact;
}

function derive(
  title: string,
  brand: string,
  volume: IdentityFact | undefined,
  source: CanonicalIdentity['source'] | undefined,
  declared?: string,
  declarationField = 'product_information.Fragrance Concentration',
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
              declared && extra?.concentrations.length ? declarationField : titleField,
              scope,
            )
          : undefined,
      formulation:
        formulation.length === 1
          ? fact(
              formulation[0],
              declared && extra?.formulations.length ? declarationField : titleField,
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
  declarationField?: string;
  pack?: unknown;
  packField?: string;
  /** Explicit GTIN/EAN/UPC from the adapter's validated MAIN field extractor. */
  packageGtin?: { value: string; field: string };
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
    input.declarationField,
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
        input.packField ?? 'product_information.Number of Items',
        'selected',
      );
    else e.issues.push('pack-unconfirmed');
  }
  if (input.packageGtin) {
    const value = normalizedGTIN(input.packageGtin.value);
    if (!value || /^0+$/.test(value)) e.issues.push('package-identifier-invalid');
    else e.selected.packageGtin = fact(value, input.packageGtin.field, 'selected');
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
    if (
      a.selected.packageGtin &&
      b.selected.packageGtin &&
      a.selected.packageGtin.value !== b.selected.packageGtin.value
    )
      return result('mismatch', 'package-identifier-conflict');
    let unconfirmed: string | undefined;
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
        unconfirmed ??= `${key}-unconfirmed`;
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
    let independentPackage = false;
    if (unconfirmed) {
      // Same selected trade-item identifier can compensate for UNKNOWN optional
      // facts. It cannot rescue catalog/listing identity, missing volume, risk
      // markers, or a known multipack on one side of an unknown pack count.
      independentPackage = Boolean(
        a.source?.kind === 'product' &&
        b.source?.kind === 'product' &&
        a.selected.packageGtin &&
        b.selected.packageGtin &&
        a.selected.packageGtin.value === b.selected.packageGtin.value &&
        a.selected.volume?.scope === 'selected' &&
        b.selected.volume?.scope === 'selected' &&
        a.selected.volume.value === b.selected.volume.value &&
        a.line &&
        b.line &&
        !a.issues.length &&
        !b.issues.length &&
        [a.selected.pack, b.selected.pack].every((pack) => !pack || pack.value === '1'),
      );
      if (!independentPackage) return result('insufficient', unconfirmed);
    }
    if (
      (a.negated.length || b.negated.length) &&
      !a.selected.concentration &&
      !b.selected.concentration
    )
      return result('insufficient', 'negated-selection-unconfirmed');
    if (a.issues.length || b.issues.length)
      return result('insufficient', a.issues[0] ?? b.issues[0]);
    if (independentPackage) return result('verified', 'independent-package-evidence');
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
