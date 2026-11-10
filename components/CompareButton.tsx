'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Loader2, Search } from 'lucide-react';
import { compareOffersNow, verifyProductLinksNow } from '@/lib/actions';

export default function CompareButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  const [links, setLinks] = useState('');
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-ghost px-3 py-2 text-xs"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const result = await compareOffersNow(productId);
              if (result.ok) {
                setMessage(
                  `Store search completed (${result.data.count} verified offers including this store).`,
                );
                router.refresh();
              } else setMessage(result.error);
            })
          }
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Search className="size-3.5" aria-hidden />
          )}
          {isPending ? 'Searching stores' : 'Compare stores'}
        </button>
        <button
          type="button"
          className="btn-ghost px-3 py-2 text-xs"
          disabled={isPending}
          onClick={() => setShowLinks(!showLinks)}
        >
          {showLinks ? 'Hide links' : 'Verify product links'}
        </button>
      </div>
      {showLinks && (
        <form
          className="flex w-full max-w-md flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const candidates = links
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean);
            if (candidates.length < 1 || candidates.length > 2) {
              setMessage('Enter one or two product URLs, one per line.');
              return;
            }
            startTransition(async () => {
              setMessage(null);
              const result = await verifyProductLinksNow(productId, candidates);
              if (result.ok) {
                const summary = result.data.statuses.join('; ');
                setMessage(
                  result.data.verified
                    ? `${result.data.verified} link(s) verified. ${summary}. Existing offers preserved.`
                    : `No newly verified offers. ${summary}. Existing offers unchanged.`,
                );
                if (result.data.verified) router.refresh();
              } else setMessage(result.error);
            });
          }}
        >
          <label htmlFor={`compare-links-${productId}`} className="text-xs text-muted">
            One or two exact Amazon, Flipkart or Myntra HTTPS product URLs. Each
            verification may use paid API credits; manual checks have a separate 10-minute
            cooldown.
          </label>
          <textarea
            id={`compare-links-${productId}`}
            className="w-full rounded-md border border-line bg-paper p-2 text-xs"
            rows={3}
            value={links}
            onChange={(event) => setLinks(event.target.value)}
            placeholder="https://www.flipkart.com/..."
          />
          <button
            type="submit"
            className="btn-ghost self-start px-3 py-2 text-xs"
            disabled={isPending}
          >
            {isPending ? 'Verifying…' : 'Verify these links'}
          </button>
        </form>
      )}
      <span role="status" aria-live="polite" className="text-xs text-muted">
        {message}
      </span>
    </div>
  );
}
