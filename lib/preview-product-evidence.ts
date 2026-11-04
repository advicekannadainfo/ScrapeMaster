import { timingSafeEqual } from 'node:crypto';
import {
  readCanonicalIdentity,
  canonicalValidationFailures,
  independentFragrance,
} from '@/lib/scraper/matching/fragrance';
import { freshProfilePrice } from '@/lib/scraper/matching/observations';
import { flipkartProductInput } from '@/lib/scraper/retail-product-input';

export function authorizeEvidenceRead(
  environment: string | undefined,
  secret: string | undefined,
  authorization: string | null,
) {
  if (environment !== 'preview') return 404;
  if (!secret) return 503;
  const expected = Buffer.from(`Bearer ${secret}`),
    received = Buffer.from(authorization ?? '');
  return expected.length === received.length && timingSafeEqual(expected, received)
    ? 200
    : 401;
}
export function evidenceLookupURL(value: string | null) {
  if (!value || value.length > 2048) return undefined;
  try {
    return flipkartProductInput(value).url;
  } catch {
    return undefined;
  }
}
/** No raw field values, identifiers, price, subscribers or product titles returned. */
export function productEvidenceSummary(record: Record<string, unknown> | null) {
  if (!record) return { found: false };
  const value = record.canonicalIdentity;
  const parsed = readCanonicalIdentity(value);
  const object = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const observation = object(record.priceObservation);
  return {
    found: true,
    canonicalIdentity: {
      state:
        value === undefined
          ? 'missing'
          : value === null
            ? 'null'
            : parsed
              ? 'valid'
              : 'invalid',
      validationFailures: canonicalValidationFailures(value),
      optionalAttributeTypes: Object.fromEntries(
        ['concentration', 'formulation', 'edition'].map((field) => {
          const v = object(object(value).selected)[field];
          return [field, v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v];
        }),
      ),
      issuesValidated: Boolean(parsed),
      independentlyValidated: independentFragrance(value),
      issues: parsed?.issues ?? [],
      selectedVolumePresent: Boolean(parsed?.selected.volume),
      selectedVolumeField: parsed?.selected.volume?.field ?? null,
    },
    priceObservation: {
      present: record.priceObservation != null,
      observedAtPresent: typeof observation.observedAt === 'string',
      boundAndFresh:
        typeof record.title === 'string' &&
        typeof record.store === 'string' &&
        typeof record.url === 'string' &&
        typeof record.currentPrice === 'number' &&
        typeof record.currency === 'string' &&
        freshProfilePrice(
          record as {
            title: string;
            store: string;
            url: string;
            currentPrice: number;
            currency: string;
          },
        ),
    },
    storedFields: {
      brandPresent: typeof record.brand === 'string',
      variantPresent: typeof record.variant === 'string',
      legacyComparisonFlag:
        typeof record.comparisonIdentityVerified === 'boolean'
          ? record.comparisonIdentityVerified
          : null,
      exactEvidencePresent: record.exactEvidence != null,
      createdAtPresent: record.createdAt != null,
      updatedAtPresent: record.updatedAt != null,
    },
  };
}
