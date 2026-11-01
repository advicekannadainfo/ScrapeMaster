import { ExternalLink, Store, Trophy } from 'lucide-react';
import CompareButton from '@/components/CompareButton';
import RelativeTime from '@/components/live/RelativeTime';
import Money from '@/components/ui/Money';
import StoreLogo from '@/components/ui/StoreLogo';
import type { Product } from '@/types';
import { cn } from '@/lib/utils';
import { verifiedOffers } from '@/lib/verified-offers';

export default function OfferComparison({ product }: { product: Product }) {
  const offers = verifiedOffers(product);
  const best = offers[0];
  // Every listing at the minimum price is a lowest price, not just the first.
  const lowest = best?.price;
  const savings =
    best && best.store !== product.store ? product.currentPrice - best.price : 0;

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="offers-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="offers-heading" className="flex items-center gap-2 font-semibold">
            <Store className="size-4 text-accent" aria-hidden /> Best price across stores
          </h2>
          <p className="mt-1 text-xs text-muted">
            {product.offersCheckedAt ? (
              <>
                Compared <RelativeTime date={product.offersCheckedAt} />
              </>
            ) : (
              'Searching other stores for this product…'
            )}
          </p>
        </div>
        <CompareButton productId={product._id} />
      </div>

      {savings > 0 && (
        <p className="mt-4 rounded-lg bg-down/10 px-3 py-2 text-sm text-down">
          Save{' '}
          <Money amount={savings} currency={product.currency} className="font-semibold" />{' '}
          by buying on {best.storeName}.
        </p>
      )}

      {offers.length > 1 ? (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {offers.map((offer) => (
            <li key={offer.store}>
              <a
                href={offer.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn(
                  'flex items-center gap-3 px-3 py-3 transition hover:bg-paper sm:px-4',
                  offer.price === lowest && 'bg-accent-soft/40',
                )}
              >
                <StoreLogo url={offer.url} name={offer.storeName} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {offer.storeName}
                    {offer.price === lowest && offers.length > 1 && (
                      <span className="inline-flex items-center gap-1 rounded bg-down px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                        <Trophy className="size-3" aria-hidden /> Lowest
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {offer.store === product.store ? 'This listing' : offer.title}
                  </span>
                </span>
                <Money
                  amount={offer.price}
                  currency={offer.currency}
                  className="num shrink-0 font-semibold"
                />
                <ExternalLink className="size-4 shrink-0 text-muted" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">
          No verified match on other supported stores yet.
        </p>
      )}
    </section>
  );
}
