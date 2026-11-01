import { TrendingDown } from 'lucide-react';
import DealBadge from '@/components/DealBadge';
import LivePrice from '@/components/live/LivePrice';
import Money from '@/components/ui/Money';
import ProductTile from '@/components/ui/ProductTile';
import Sparkline from '@/components/ui/Sparkline';
import type { Product } from '@/types';
import { getDealVerdict } from '@/lib/deal';
import { verifiedOffers } from '@/lib/verified-offers';

export default function ProductCard({
  product,
  priority,
}: {
  product: Product;
  priority?: boolean;
}) {
  const history = (product.priceHistory ?? []).map((p) => p.price);
  const verdict = getDealVerdict({
    ...product,
    priceHistory: product.priceHistory ?? [],
  });
  const cheaper = verifiedOffers(product)
    .filter((o) => o.store !== product.store && o.price < product.currentPrice)
    .sort((a, b) => a.price - b.price)[0];

  return (
    <ProductTile
      href={`/products/${product._id}`}
      image={product.image}
      title={product.title}
      store={{ name: product.storeName ?? 'Store', url: product.url }}
      category={product.category}
      currency={product.currency}
      currentPrice={product.currentPrice}
      originalPrice={product.originalPrice}
      stars={product.stars}
      reviews={product.reviewsCount}
      outOfStock={product.isOutOfStock}
      priority={priority}
      price={
        <LivePrice
          productId={product._id}
          price={product.currentPrice}
          currency={product.currency}
        />
      }
      badge={
        verdict.level === 'great' || verdict.level === 'good' ? (
          <DealBadge verdict={verdict} className="shadow-sm" />
        ) : undefined
      }
      aside={
        history.length > 1 ? (
          <Sparkline values={history} className="mb-1 h-8 w-16 shrink-0" />
        ) : undefined
      }
      note={
        cheaper && (
          <p className="mt-1 flex items-center gap-1.5 truncate rounded-lg bg-down/10 px-2 py-1.5 text-xs text-down">
            <TrendingDown className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              <Money
                amount={cheaper.price}
                currency={cheaper.currency}
                className="font-semibold"
              />{' '}
              on {cheaper.storeName}
            </span>
          </p>
        )
      }
    />
  );
}
