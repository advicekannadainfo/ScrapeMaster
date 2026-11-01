import { ScrapeError, isTransient } from './errors';

export type ProviderRoute<T> = { run: () => Promise<T[]>; paid: boolean };
/** Fallback is a different route, never a retry. Caller must explicitly budget it. */
export async function dedicatedFirst<T>(
  primary: ProviderRoute<T>,
  fallback?: ProviderRoute<T>,
  policy: { allowFallback: boolean; maxPaidRequests: 0 | 1 | 2 } = {
    allowFallback: false,
    maxPaidRequests: 1,
  },
) {
  let paid = 0;
  let primaryError: unknown;
  const run = (route: ProviderRoute<T>) => {
    if (route.paid && ++paid > policy.maxPaidRequests)
      throw new ScrapeError(
        'Paid route budget exhausted; fallback not run',
        'unsupported',
      );
    return route.run();
  };
  try {
    const results = await run(primary);
    if (results.length || !fallback || !policy.allowFallback) return results;
  } catch (error) {
    if (!fallback || !policy.allowFallback || !isTransient(error)) throw error;
    primaryError = error;
  }
  const results = await run(fallback!);
  if (!results.length && primaryError) throw primaryError;
  return results;
}
