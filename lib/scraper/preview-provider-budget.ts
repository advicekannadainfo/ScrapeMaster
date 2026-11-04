import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ScrapeError } from './errors';
type Budget = { used: number; routes: Record<string, number> };
const scope = new AsyncLocalStorage<Budget>();
const allowed = new Set([
  'flipkart:product',
  'amazon:search',
  'myntra:search',
  'amazon:product',
  'myntra:product',
]);
export const previewBudgetActive = () => scope.getStore() !== undefined;
export function reservePreviewProviderRequest(store: string, kind: 'search' | 'product') {
  const budget = scope.getStore();
  if (!budget) return;
  const route = `${store}:${kind}`;
  if (!allowed.has(route) || budget.used >= 5 || budget.routes[route])
    throw new ScrapeError(
      'Preview provider budget exhausted or route denied',
      'unsupported',
    );
  budget.used++;
  budget.routes[route] = 1;
}
export function denyPreviewGenericRequest() {
  if (previewBudgetActive())
    throw new ScrapeError('Generic requests disabled in Preview dry run', 'unsupported');
}
export async function withPreviewProviderBudget<T>(run: (budget: Budget) => Promise<T>) {
  if (process.env.VERCEL_ENV !== 'preview') throw new Error('Preview only');
  if (scope.getStore()) throw new Error('Nested Preview budgets forbidden');
  const budget: Budget = { used: 0, routes: {} };
  return scope.run(budget, () => run(budget));
}
