import type { Metadata } from 'next';
import { verifiedOffers } from '@/lib/verified-offers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ExternalLink,
  MessageSquare,
  Sigma,
  Star,
  Tag,
} from 'lucide-react';
import BuyMeter from '@/components/BuyMeter';
import OfferComparison from '@/components/OfferComparison';
import PriceChart from '@/components/PriceChart';
import ProductCard from '@/components/ProductCard';
import TrackModal from '@/components/TrackModal';
import LiveBadge from '@/components/live/LiveBadge';
import LivePrice from '@/components/live/LivePrice';
import { LiveProvider } from '@/components/live/LiveProvider';
import LiveWatchers from '@/components/live/LiveWatchers';
import RefreshButton from '@/components/live/RefreshButton';
import RelativeTime from '@/components/live/RelativeTime';
import Money from '@/components/ui/Money';
import ProductImage from '@/components/ui/ProductImage';
import StatTile from '@/components/ui/StatTile';
import { getProductById, getSimilarProducts } from '@/lib/data/products';
import { getDealVerdict } from '@/lib/deal';
import { refreshIfStale } from '@/lib/services/refresh';
import { formatNumber, formatPrice, truncate } from '@/lib/utils';

export const dynamic = 'force-dynamic';
// Room for streamed store data; Vercel Hobby defaults to 10 seconds.
export const maxDuration = 60;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) return { title: 'Product not found' };

  const title = truncate(product.title, 60);
  const description = `${formatPrice(product.currentPrice, product.currency)} now · lowest ${formatPrice(
    product.lowestPrice,
    product.currency,
  )}. Track the price history and get drop alerts.`;

  const path = `/products/${id}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      images: product.image ? [product.image] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) notFound();

  // Re-check stale prices after responding; the live stream pushes any change.
  after(() => refreshIfStale(id));

  const similar = await getSimilarProducts(id);
  const history = product.priceHistory ?? [];
  const verdict = getDealVerdict({ ...product, priceHistory: history });
  // Send buyers to the cheapest matching listing, falling back to this one.
  const buyOffer = verifiedOffers(product)[0] ?? {
    url: product.url,
    store: product.store,
    storeName: product.storeName,
  };
  const savings = product.originalPrice - product.currentPrice;
  const isLowest = history.length > 1 && product.currentPrice <= product.lowestPrice;
  const bullets = product.description?.split('\n').filter(Boolean).slice(0, 8) ?? [];

  return (
    <LiveProvider productIds={[product._id, ...similar.map((p) => p._id)]}>
      <div className="container py-8 lg:py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden /> All products
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="card relative aspect-square overflow-hidden bg-white p-4">
              <ProductImage
                resize={800}
                src={product.image}
                alt={product.title}
                fill
                priority
                sizes="(min-width: 1024px) 45vw, 100vw"
                className="object-contain p-10 mix-blend-multiply"
              />
              {isLowest && (
                <span className="absolute left-4 top-4 rounded-md bg-down px-2.5 py-1 text-xs font-medium text-white">
                  Lowest price recorded
                </span>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-8">
            <header className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <LiveBadge />
                <p className="eyebrow">
                  {product.storeName} · {product.category}
                </p>
              </div>
              <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                {product.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
                {product.stars > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="size-4 fill-current text-amber-500" aria-hidden />
                    <span className="num text-ink">{product.stars.toFixed(1)}</span>
                  </span>
                )}
                {product.reviewsCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="size-4" aria-hidden />
                    <span className="num text-ink">
                      {formatNumber(product.reviewsCount)}
                    </span>{' '}
                    reviews
                  </span>
                )}
                <LiveWatchers productId={product._id} initial={product.watchers ?? 0} />
              </div>
            </header>

            <section className="card p-5 sm:p-6" aria-labelledby="price-heading">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p id="price-heading" className="eyebrow">
                    Current price
                  </p>
                  <p className="mt-2 flex flex-wrap items-baseline gap-3">
                    <LivePrice
                      productId={product._id}
                      price={product.currentPrice}
                      currency={product.currency}
                      className="text-4xl font-semibold sm:text-5xl"
                    />
                    {savings > 0 && (
                      <span className="num text-lg text-muted line-through">
                        <Money
                          amount={product.originalPrice}
                          currency={product.currency}
                        />
                      </span>
                    )}
                    {product.discountRate > 0 && (
                      <span className="num rounded-md bg-down/10 px-2 py-0.5 text-sm font-medium text-down">
                        −{product.discountRate}%
                      </span>
                    )}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    {product.isOutOfStock ? (
                      <span className="text-up">Currently out of stock</span>
                    ) : (
                      <span className="text-down">In stock</span>
                    )}
                    {product.updatedAt && (
                      <>
                        {' · checked '}
                        <RelativeTime date={product.updatedAt} productId={product._id} />
                      </>
                    )}
                  </p>
                </div>
                <RefreshButton productId={product._id} />
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <TrackModal productId={product._id} title={product.title} />
                <a
                  href={buyOffer.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="btn-accent py-3.5 text-[15px]"
                >
                  {buyOffer.store !== product.store ? 'Best price on ' : 'Buy on '}
                  {buyOffer.storeName}
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              </div>
            </section>

            <BuyMeter verdict={verdict} />

            <OfferComparison product={product} />

            <section
              aria-label="Price statistics"
              className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line"
            >
              <StatTile
                label="Current"
                icon={Tag}
                value={
                  <Money amount={product.currentPrice} currency={product.currency} />
                }
                tone="accent"
              />
              <StatTile
                label="Average"
                icon={Sigma}
                value={
                  <Money amount={product.averagePrice} currency={product.currency} />
                }
              />
              <StatTile
                label="Highest"
                icon={ArrowUp}
                value={
                  <Money amount={product.highestPrice} currency={product.currency} />
                }
                tone="up"
              />
              <StatTile
                label="Lowest"
                icon={ArrowDown}
                value={<Money amount={product.lowestPrice} currency={product.currency} />}
                tone="down"
              />
            </section>

            <section className="card p-5 sm:p-6" aria-labelledby="history-heading">
              <div className="mb-4 flex items-center justify-between">
                <h2 id="history-heading" className="eyebrow">
                  Price history
                </h2>
                <span className="num text-xs text-muted">{history.length} snapshots</span>
              </div>
              <PriceChart history={history} currency={product.currency} />
            </section>

            {bullets.length > 0 && (
              <section aria-labelledby="about-heading">
                <h2 id="about-heading" className="eyebrow">
                  About this item
                </h2>
                <ul className="mt-4 flex flex-col gap-3 text-[15px] leading-relaxed text-muted">
                  {bullets.map((line, i) => (
                    <li key={i} className="flex gap-3">
                      <span
                        className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink/40"
                        aria-hidden
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        {similar.length > 0 && (
          <section className="mt-20" aria-labelledby="similar-heading">
            <h2 id="similar-heading" className="text-2xl font-semibold tracking-tight">
              You might also track
            </h2>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4">
              {similar.map((item) => (
                <div key={item._id} className="reveal">
                  <ProductCard product={item} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </LiveProvider>
  );
}
