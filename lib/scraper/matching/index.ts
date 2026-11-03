import { categoryFor } from '../product-identity';
import { fragranceDecision, fragranceProfile, type FragranceInput } from './fragrance';
/** The only new production profile. Other categories retain the existing engine. */
export const categoryProfiles = { perfume: fragranceProfile } as const;
export function categoryDecision(a: FragranceInput, b: FragranceInput) {
  if (
    categoryFor(a.title) !== 'perfume' &&
    categoryFor(b.title) !== 'perfume' &&
    a.canonicalIdentity == null &&
    b.canonicalIdentity == null
  )
    return undefined;
  if (categoryFor(a.title) !== 'perfume' || categoryFor(b.title) !== 'perfume')
    return {
      status: 'mismatch' as const,
      reason: 'category-conflict',
      confidence: 'none' as const,
      profile: 'fragrance-v1',
    };
  return fragranceDecision(a, b);
}
