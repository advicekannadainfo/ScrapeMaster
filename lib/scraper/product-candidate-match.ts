/** Compatibility entry points; discovery and rendering share the category profile. */
import {
  fragranceDecision,
  scentLine,
  volumeMl,
  searchFragranceIdentity,
  type FragranceInput,
} from './matching/fragrance';
export type ProductCandidateIdentity = FragranceInput;
export function matchingFetchedFragrance(
  source: ProductCandidateIdentity,
  candidate: ProductCandidateIdentity,
) {
  return fragranceDecision(source, candidate).status === 'verified';
}
export function fragranceDiscoveryQuery(source: ProductCandidateIdentity) {
  if (!source.brand || !source.variant) return;
  const volume = volumeMl(source.variant),
    line = scentLine(source.title, source.brand);
  if (!volume || !line || !/\b(perfume|parfum|fragrance)\b/i.test(source.title)) return;
  const printed = [
    ...source.title.matchAll(
      /\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b/gi,
    ),
  ].map((m) => volumeMl(m[0]));
  if (!printed.length || printed.some((v) => v !== volume)) return;
  if (!matchingFetchedFragrance(source, source)) return;
  return `${source.brand.trim()} ${line} ${volume}ml`;
}
export function enrichSearchFragranceIdentity<T extends ProductCandidateIdentity>(
  source: ProductCandidateIdentity,
  candidate: T,
): T {
  // Enrich only a previously unannotated listing. Never downgrade Product or
  // persisted evidence (including invalid/partial evidence) into title claims.
  if (candidate.canonicalIdentity != null) return candidate;
  if (
    !source.brand ||
    !source.variant ||
    !candidate.title ||
    !scentLine(candidate.title, source.brand)
  )
    return candidate;
  const volumes = [
    ...candidate.title.matchAll(
      /\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b/gi,
    ),
  ].map((m) => volumeMl(m[0]));
  if (!volumes.length || new Set(volumes).size !== 1 || !volumes[0]) return candidate;
  const enriched = {
    ...candidate,
    brand: candidate.brand ?? source.brand,
    variant: candidate.variant ?? `${volumes[0]}ml`,
  };
  const evidence = searchFragranceIdentity(enriched, enriched.brand);
  const result = { ...enriched, ...(evidence ? { canonicalIdentity: evidence } : {}) };
  return matchingFetchedFragrance(source, result) ? result : candidate;
}
