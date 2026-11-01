'use client';

import { useRouter } from 'next/navigation';
import {
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowRight, ClipboardPaste, Loader2, Search } from 'lucide-react';
import { scrapeAndStoreProduct } from '@/lib/actions';
import { usePreferences } from '@/components/PreferencesProvider';
import { clearRecent, readRecent, saveRecent } from '@/components/search/recent';
import SuggestionList, {
  suggestionId,
  type SuggestionItem,
} from '@/components/search/SuggestionList';
import { useSuggestions } from '@/components/search/useSuggestions';
import { getCountry } from '@/lib/locale';
import { cn, isValidProductURL } from '@/lib/utils';

const STEPS = ['Fetching page', 'Reading price', 'Saving snapshot'];

/** One box for both: a product link starts tracking, anything else searches stores. */
export default function Searchbar({ defaultValue = '' }: { defaultValue?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const country = getCountry(usePreferences().preferences.country);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const suggestions = useSuggestions(url, country.code, open);

  // Empty box: recent searches. Typing: matching tracked products, then searches.
  const items = useMemo<SuggestionItem[]>(() => {
    if (!url.trim()) return recent.map((value) => ({ kind: 'recent', value }));
    return [
      ...suggestions.products.map((product) => ({ kind: 'product' as const, product })),
      ...suggestions.queries.map((value) => ({ kind: 'query' as const, value })),
    ];
  }, [url, recent, suggestions.products, suggestions.queries]);
  const showList = open && items.length > 0 && !isPending;

  const searchFor = (query: string) => {
    saveRecent(query);
    setOpen(false);
    setUrl(query);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const pick = (item: SuggestionItem) => {
    if (item.kind === 'product') {
      setOpen(false);
      router.push(`/products/${item.product._id}`);
    } else {
      searchFor(item.value);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showList) {
      if (event.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // -1 is the text box itself; wrap around through it like browser search boxes.
      setActiveIndex((i) => {
        const next = i + step;
        if (next >= items.length) return -1;
        if (next < -1) return items.length - 1;
        return next;
      });
    } else if (event.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
      event.preventDefault();
      pick(items[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const input = url.trim();
    if (!input) return;

    if (!/^https?:\/\//i.test(input)) {
      if (input.length < 2) {
        setError('Type a product name or paste a link');
        return;
      }
      saveRecent(input);
      setOpen(false);
      router.push(`/search?q=${encodeURIComponent(input)}`);
      return;
    }

    if (!isValidProductURL(input)) {
      setError('That link does not look like a product page');
      return;
    }

    setStep(0);
    const timer = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      2200,
    );

    startTransition(async () => {
      const result = await scrapeAndStoreProduct(input);
      clearInterval(timer);
      if (result.ok) {
        router.push(`/products/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text.trim());
      setError(null);
    } catch {
      // Clipboard permission denied; the user can still paste manually.
    }
  };

  return (
    <form onSubmit={submit} className="w-full" noValidate>
      <div
        className={cn(
          'group relative flex items-center gap-2 rounded-xl border bg-surface p-1.5 shadow-sm transition focus-within:ring-4 focus-within:ring-accent/10',
          error ? 'border-up/60' : 'border-line focus-within:border-accent/60',
        )}
      >
        <Search className="ml-2 size-5 shrink-0 text-muted" aria-hidden />
        <label htmlFor="product-url" className="sr-only">
          Search products or paste a link
        </label>
        <input
          id="product-url"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
            if (error) setError(null);
          }}
          onFocus={() => {
            setRecent(readRecent());
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={showList}
          aria-controls="search-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={
            showList && activeIndex >= 0 ? suggestionId(activeIndex) : undefined
          }
          placeholder="Search a product or paste any store link"
          aria-invalid={Boolean(error)}
          aria-describedby="product-url-status"
          disabled={isPending}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none placeholder:text-muted/80 focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-search-cancel-button]:hidden"
        />
        {!url && !isPending && (
          <button
            type="button"
            onClick={paste}
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition hover:bg-paper hover:text-ink sm:inline-flex"
          >
            <ClipboardPaste className="size-3.5" aria-hidden />
            Paste
          </button>
        )}
        <button
          type="submit"
          className="btn-accent shrink-0"
          disabled={!url || isPending}
          // The text label is hidden on phones; keep the button named for screen readers.
          aria-label={
            /^https?:\/\//i.test(url.trim()) ? 'Track price' : 'Find best price'
          }
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="size-4" aria-hidden />
          )}
          <span className="hidden sm:inline">
            {isPending
              ? 'Tracking'
              : /^https?:\/\//i.test(url.trim())
                ? 'Track price'
                : 'Find best price'}
          </span>
        </button>

        {showList && (
          <SuggestionList
            items={items}
            activeIndex={activeIndex}
            typed={url}
            onPick={pick}
            onHover={setActiveIndex}
            onClearRecent={() => {
              clearRecent();
              setRecent([]);
            }}
          />
        )}
      </div>

      <p
        id="product-url-status"
        role="status"
        aria-live="polite"
        className="mt-3 min-h-5 text-sm"
      >
        {isPending ? (
          <span className="inline-flex items-center gap-2 text-muted">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" />
            <span className="num text-xs">
              {step + 1}/{STEPS.length}
            </span>
            {STEPS[step]}…
          </span>
        ) : error ? (
          <span className="text-up">{error}</span>
        ) : (
          <span className="text-muted">
            {country.flag} Search supported stores for your region, or paste a product
            link. Results depend on configured sources and verified matches.
          </span>
        )}
      </p>
    </form>
  );
}
