import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ScrapeError } from './errors';
export type PreviewProviderMode = 'all' | 'amazon-only';
type Budget = {
  used: number;
  maximum: 3 | 5;
  mode: PreviewProviderMode;
  routes: Record<string, number>;
  phase: 'diagnostic' | 'tracking' | 'comparison' | 'closed';
};
const scope = new AsyncLocalStorage<Budget>();
const allowed = new Set([
  'flipkart:product',
  'amazon:search',
  'myntra:search',
  'amazon:product',
  'myntra:product',
]);
export const previewBudgetActive = () => scope.getStore() !== undefined;
export const previewWebsiteTestEnabled = () =>
  process.env.VERCEL_ENV === 'preview' &&
  process.env.MERIDEALS_PREVIEW_TRACKING_TEST === 'true';
export const previewWebsiteBudgetActive = () => scope.getStore()?.phase === 'comparison';
export function reservePreviewProviderRequest(store: string, kind: 'search' | 'product') {
  const budget = scope.getStore();
  if (!budget) {
    if (previewWebsiteTestEnabled())
      throw new ScrapeError('Preview test requires a bounded flow', 'unsupported');
    return;
  }
  const route = `${store}:${kind}`;
  if (
    !allowed.has(route) ||
    budget.phase === 'closed' ||
    (budget.phase === 'tracking' && route !== 'flipkart:product') ||
    (budget.phase === 'comparison' && route === 'flipkart:product') ||
    (budget.mode === 'amazon-only' && store === 'myntra') ||
    budget.used >= budget.maximum ||
    budget.routes[route]
  )
    throw new ScrapeError(
      'Preview provider budget exhausted or route denied',
      'unsupported',
    );
  budget.used++;
  budget.routes[route] = 1;
}
export function denyPreviewGenericRequest() {
  if (previewBudgetActive() || previewWebsiteTestEnabled())
    throw new ScrapeError('Generic requests disabled in Preview dry run', 'unsupported');
}
export async function withPreviewProviderBudget<T>(
  run: (budget: Budget) => Promise<T>,
  mode: PreviewProviderMode = 'all',
) {
  if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
  if (scope.getStore()) throw new Error('Nested Preview budgets forbidden');
  if (mode !== 'all' && mode !== 'amazon-only') throw new Error('Invalid Preview mode');
  const budget: Budget = {
    used: 0,
    maximum: mode === 'amazon-only' ? 3 : 5,
    mode,
    routes: {},
    phase: 'diagnostic',
  };
  return scope.run(budget, () => run(budget));
}

/** Explicitly re-enter the SAME budget inside Next after(); never depend on
 * implicit AsyncLocalStorage inheritance or create a second callback budget. */
export function createPreviewTrackingBudget() {
  if (
    !previewWebsiteTestEnabled() ||
    process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION === 'true' ||
    scope.getStore()
  )
    throw new Error('Bounded Preview tracking unavailable');
  const budget: Budget = {
    used: 0,
    maximum: 5,
    mode: 'all',
    routes: {},
    phase: 'tracking',
  };
  let started = false;
  let tracked = false;
  let compared = false;
  return {
    async track<T>(run: () => Promise<T>) {
      if (started || scope.getStore()) throw new Error('Preview tracking already used');
      started = true;
      try {
        const result = await scope.run(budget, run);
        tracked = true;
        return result;
      } catch (error) {
        budget.phase = 'closed';
        throw error;
      }
    },
    async compare<T>(run: () => Promise<T>) {
      if (!tracked || compared || scope.getStore())
        throw new Error('Preview comparison unavailable');
      compared = true;
      budget.phase = 'comparison';
      try {
        return await scope.run(budget, run);
      } finally {
        budget.phase = 'closed';
      }
    },
    summary: () => ({ maximum: 5, used: budget.used, routes: { ...budget.routes } }),
  };
}
