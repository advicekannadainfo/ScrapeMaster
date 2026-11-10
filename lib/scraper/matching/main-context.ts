import type { CanonicalIdentity, IdentityFact } from './contracts';
import { fragranceContext } from './context';
import type { ExactEvidence } from '../exact-evidence';
type Context = NonNullable<CanonicalIdentity['context']>;
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 4000) : '');
const fact = (value: string, field: string): IdentityFact => ({
  value,
  field,
  scope: 'main',
});
const packRisk =
  /\b(?:packs?\s+of|multipacks?|combos?|bundles?|gift\s*sets?|refills?|testers?|samples?|miniatures?)\b|\b\d+\s*[x×]\s*\d+\s*ml\b/i;
const vehicleRisk =
  /\b(?:oil[- ](?:only|based)|roll[- ]?on|attar|body\s+mist|body\s+spray|deodorant|spray)\b/i;
/** Bounded MAIN fields only; never related items, sellers or variant catalogs.
 * Ambiguous concentration labels stay ambiguous: this does NOT prove vehicle. */
export function mainFragranceContext(
  store: string,
  raw: unknown,
  validated?: ExactEvidence,
): Context | undefined {
  const body = obj(raw);
  const root = store === 'amazon' ? body : obj(body.product_results);
  const info =
    store === 'amazon'
      ? obj(root.product_information)
      : obj(obj(root.specifications).General);
  const entries: [string, string][] = [
    ['main.title', text(root.title)],
    ...(store === 'amazon'
      ? ([
          ['main.title', text(root.main_title)],
          ['product_information.Item Form', text(info['Item Form'])],
          ['description', text(root.description)],
          ['product_description', text(root.product_description)],
          [
            'feature_bullets',
            Array.isArray(root.feature_bullets)
              ? root.feature_bullets.slice(0, 20).map(text).join(' ').slice(0, 4000)
              : text(root.feature_bullets),
          ],
        ] as [string, string][])
      : ([
          ['specifications.General.Key Features', text(info['Key Features'])],
          ['description', text(root.description)],
          [
            'highlights',
            Array.isArray(root.highlights)
              ? root.highlights.slice(0, 20).map(text).join(' ').slice(0, 4000)
              : text(root.highlights),
          ],
        ] as [string, string][])),
  ];
  const risk = entries.find(
    ([, v]) => packRisk.test(v) || vehicleRisk.test(v) || /^oil$/i.test(v.trim()),
  );
  const context: Context = {};
  if (risk)
    context.risk = fact(
      packRisk.test(risk[1]) ? 'pack-risk' : 'formulation-risk',
      risk[0],
    );
  if (store === 'flipkart') {
    for (const field of ['Number of Items', 'Pack Size']) {
      const v = info[field];
      if (v !== undefined && v !== null && (typeof v !== 'string' || v.trim() !== '1'))
        context.risk = fact('pack-risk', `specifications.General.${field}`);
    }
    const declared = text(info['Fragrance Concentration']);
    if (
      fragranceContext(declared).concentrations.length ||
      fragranceContext(declared).formulations.length
    )
      context.risk = fact(
        'formulation-risk',
        'specifications.General.Fragrance Concentration',
      );
  }
  const prefix = store === 'amazon' ? 'product_information' : 'specifications.General';
  for (const field of [
    'GTIN',
    'EAN',
    'UPC',
    'Model Number',
    'Manufacturer Part Number',
  ]) {
    const v = info[field];
    const proof = ['GTIN', 'EAN', 'UPC'].includes(field)
      ? validated?.gtin
      : validated?.mpn;
    if (v !== undefined && v !== null && !proof)
      context.risk = fact('identity-risk', `${prefix}.${field}`);
  }
  if (
    !context.risk &&
    store === 'amazon' &&
    /^perfume oil$/i.test(text(info['Fragrance Concentration']).trim()) &&
    /^liquid$/i.test(text(info['Item Form']).trim()) &&
    /\bparfum\b/i.test(text(root.title)) &&
    !fragranceContext(text(root.title)).formulations.length &&
    !fragranceContext(text(root.main_title)).formulations.length
  ) {
    context.formulation = fact(
      'concentration-label-only',
      'product_information.Fragrance Concentration',
    );
  }
  if (!context.risk && store === 'flipkart') {
    const keyFeatures = text(info['Key Features']).replace(/’/g, "'");
    const percentage = /\b(\d+(?:\.\d+)?)\s*%\s*perfume oil concentration\b/i.exec(
      keyFeatures,
    );
    if (
      percentage &&
      Number(percentage[1]) > 0 &&
      Number(percentage[1]) <= 100 &&
      /\b(?:it's|it is)\s+(?:a\s+)?parfum\b/i.test(keyFeatures) &&
      !/\b(?:not|no|without)\b.{0,25}\bparfum\b/i.test(keyFeatures)
    )
      context.formulation = fact(
        'parfum-strength',
        'specifications.General.Key Features',
      );
  }
  return Object.keys(context).length ? context : undefined;
}
