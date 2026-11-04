/** Independently selected MAIN facts, not attributes inferred from title text.
 * These gates preserve the existing exact-evidence route; they do not register
 * new canonical matchers or enable a provider/category without adapter proof. */
export const selectedEvidencePolicies = {
  earbuds: { enabled: true, required: ['colour', 'pack'] },
  phone: { enabled: true, required: ['colour', 'ram', 'disk', 'pack'] },
  laptop: { enabled: true, required: ['colour', 'ram', 'disk', 'cpu', 'pack'] },
  fashion: { enabled: true, required: ['colour', 'fashionSize', 'pack'] },
  perfume: { enabled: true, required: ['quantity', 'concentration', 'pack'] },
  grocery: { enabled: true, required: ['quantity', 'pack'] },
  appliance: { enabled: true, required: ['capacity', 'colour', 'pack'] },
  // Design gate only. No grounded Product API publication extractor is present.
  book: { enabled: false, required: ['isbn', 'edition', 'language', 'binding'] },
} as const;

export function selectedEvidenceStatus(
  category: string,
  selected: Readonly<Record<string, unknown>>,
) {
  const policy =
    selectedEvidencePolicies[category as keyof typeof selectedEvidencePolicies];
  if (!policy) return 'unsupported-category' as const;
  if (!policy.enabled) return 'profile-not-enabled' as const;
  return policy.required.every((key) => selected[key] != null)
    ? ('complete' as const)
    : ('missing-selected-evidence' as const);
}
