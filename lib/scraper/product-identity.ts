/** Shared identity evidence. No price, seller or URL is treated as variant evidence. */
export type Category =
  | 'perfume'
  | 'earbuds'
  | 'phone'
  | 'laptop'
  | 'fashion'
  | 'grocery'
  | 'appliance'
  | 'book'
  | 'general';
export type Attributes = Record<string, string>;
export function categoryFor(title: string): Category {
  if (/\b(book|isbn|paperback|hardcover|hardback)\b/i.test(title)) return 'book';
  if (/\b(perfume|parfum|fragrance)\b/i.test(title)) return 'perfume';
  if (/\b(earbuds|airdopes|ows|tws)\b/i.test(title)) return 'earbuds';
  if (/\b(laptop|notebook|macbook)\b/i.test(title)) return 'laptop';
  if (/\b(iphone|smartphone|galaxy|pixel|mobile phone)\b/i.test(title)) return 'phone';
  if (/\b(washing machine|refrigerator|microwave|air conditioner)\b/i.test(title))
    return 'appliance';
  if (/\b(shirt|dress|jeans|trousers|shoes|kurta)\b/i.test(title)) return 'fashion';
  if (/\b(rice|flour|milk|coffee|tea|sugar|oil)\b/i.test(title)) return 'grocery';
  return 'general';
}
export function normalizedValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(
      /(\d+(?:\.\d+)?)\s*(millilitres?|milliliters?|ml|litres?|liters?|l|kilograms?|kg|grams?|g)\b/g,
      (_, n, unit: string) => {
        const volume = /^(ml|mill|l|lit)/.test(unit);
        const scale =
          /^(l|lit|kg|kilogram)/.test(unit) && !unit.startsWith('mill') ? 1000 : 1;
        return `${Number(n) * scale}${volume ? 'ml' : 'g'}`;
      },
    )
    .replace(/(\d+)\s*(gb|tb)\b/g, '$1$2');
}
/** Only facts explicitly printed in a title/specification are extracted. */
export function titleAttributes(title: string): Attributes {
  const text = normalizedValue(title);
  const result: Attributes = {};
  const capture = (key: string, pattern: RegExp) => {
    const values = [...text.matchAll(pattern)].map((m) =>
      m.slice(1).find((value) => value !== undefined)!,
    );
    if (values.length) result[key] = [...new Set(values)].sort().join('/');
  };
  capture(
    'colour',
    /\b(black|white|blue|red|green|pink|silver|gold|grey|gray|purple|beige)\b/g,
  );
  capture('memory', /\b(\d+(?:\.\d+)?(?:gb|tb))\b/g);
  capture('ram', /\b(?:ram\s*[:=-]?\s*(\d+(?:gb|tb))|(\d+(?:gb|tb))\s*ram)\b/g);
  capture(
    'disk',
    /\b(?:(?:storage|rom|ssd|hdd)\s*[:=-]?\s*(\d+(?:gb|tb))|(\d+(?:gb|tb))\s*(?:storage|rom|ssd|hdd))\b/g,
  );
  capture(
    'cpu',
    /\b(i[3579](?:-\d+[a-z]*)?|ryzen\s*\d+(?:\s*\d+[a-z]*)?|m[1234](?:\s*(?:pro|max|ultra))?)\b/g,
  );
  capture('quantity', /\b(\d+(?:\.\d+)?(?:ml|g))\b/g);
  capture('pack', /\b(?:pack of|set of|pack size)\s*(\d+)\b/g);
  capture(
    'fashionSize',
    /\b(?:size\s*=?\s*|fashionsize=)(xxs|xs|s|m|l|xl|xxl|\d+(?:\.\d+)?)\b/g,
  );
  const isbns = [
    ...title.matchAll(
      /\bisbn(?:-1[03])?\s*:?\s*((?:97[89][ -]*(?:\d[ -]*){10})|(?:(?:\d[ -]*){9}[\dx]))\b/gi,
    ),
  ].map((m) => canonicalISBN(m[1]) ?? 'invalid');
  if (isbns.length) result.isbn = [...new Set(isbns)].join('/');
  capture(
    'language',
    /\b(english|hindi|kannada|tamil|telugu|marathi|french|german|spanish|bengali)\b/g,
  );
  const editions = [
    ...text.matchAll(
      /\b(?:(\d+(?:st|nd|rd|th)?|first|second|revised)\s+edition|edition\s*[:=-]?\s*(\d+(?:st|nd|rd|th)?|first|second|revised))\b/g,
    ),
  ].map((m) => editionKey(m[1] ?? m[2]));
  if (editions.length) result.edition = [...new Set(editions)].join('/');
  capture('concentration', /\b(edp|edt|elixir|intense)\b/g);
  return result;
}
export function selectedAttributes(
  title: string,
  specs: Record<string, string> = {},
): Attributes {
  const result = titleAttributes(title);
  // Selected specification facts only. Do not traverse available variant arrays.
  for (const [key, value] of Object.entries(specs)) {
    const name = key.toLowerCase().replace(/[\s-]/g, '');
    if (name === 'quantity' || name === 'netquantity') {
      const normalized = normalizedValue(value);
      const count = /^(\d+)\s*(?:units?|pieces?)$/.exec(normalized);
      const field = count ? 'pack' : 'quantity';
      if (!count && !/^\d+(?:\.\d+)?(?:ml|g)$/.test(normalized))
        throw new Error('Selected quantity format is unsupported');
      const selected = count ? count[1] : normalized;
      if (result[field] && result[field] !== selected)
        throw new Error('Selected quantity conflicts with title');
      result[field] = selected;
      continue;
    }
    const field = (
      {
        color: 'colour',
        colour: 'colour',
        size: 'fashionSize',
        storage: 'disk',
        capacity: 'quantity',
        ram: 'ram',
        processor: 'cpu',
        processorname: 'cpu',
        modelnumber: 'model',
        packsize: 'pack',
        isbn: 'isbn',
        isbn10: 'isbn',
        isbn13: 'isbn',
        edition: 'edition',
        language: 'language',
      } as Record<string, string>
    )[name];
    if (!field) continue;
    const normalized =
      field === 'isbn'
        ? (canonicalISBN(value) ?? 'invalid')
        : field === 'edition'
          ? editionKey(value)
          : field === 'cpu'
            ? (titleAttributes(value).cpu ?? normalizedValue(value))
            : normalizedValue(value);
    if (normalized === 'invalid') throw new Error('Invalid ISBN evidence');
    if (result[field] && result[field] !== normalized)
      throw new Error(`Selected ${field} conflicts with title`);
    result[field] = normalized;
  }
  return result;
}
/** Asymmetric missing evidence is unverified, not permission to ignore a variant. */
export function compatibleAttributes(
  a: { title: string; variant?: string },
  b: { title: string; variant?: string },
) {
  const evidence = (p: { title: string; variant?: string }) => {
    const printed = titleAttributes(p.title);
    const selected = titleAttributes(p.variant ?? '');
    for (const [key, value] of Object.entries(selected)) {
      if (!printed[key]) continue;
      if (
        key === 'memory'
          ? value.split('/').some((v) => !printed[key].split('/').includes(v))
          : printed[key] !== value
      )
        return undefined;
    }
    const attributes = titleAttributes(`${p.title} ${p.variant ?? ''}`);
    for (const entry of (p.variant ?? '').split('; ')) {
      const match =
        /^(colour|memory|quantity|pack|fashionSize|cpu|ram|disk|model|isbn|edition|language)=(.+)$/.exec(
          entry,
        );
      if (match) {
        const value =
          match[1] === 'isbn'
            ? (canonicalISBN(match[2]) ?? 'invalid')
            : match[1] === 'edition'
              ? editionKey(match[2])
              : normalizedValue(match[2]);
        if (attributes[match[1]] && attributes[match[1]] !== value) return undefined;
        attributes[match[1]] = value;
      }
    }
    return attributes;
  };
  const left = evidence(a);
  const right = evidence(b);
  if (
    !left ||
    !right ||
    [left.isbn, right.isbn].some((v) => v && (v === 'invalid' || v.includes('/')))
  )
    return false;
  const category = left.isbn || right.isbn ? 'book' : categoryFor(a.title);
  const required: Partial<Record<Category, string[]>> = {
    earbuds: ['colour'],
    phone: ['colour', 'memory'],
    laptop: ['memory'],
    fashion: ['fashionSize', 'colour'],
    grocery: ['quantity'],
    appliance: ['quantity'],
    perfume: ['quantity'],
    book: ['isbn', 'edition', 'language'],
  };
  if (
    category === 'book' &&
    [left.edition, right.edition].some((value) => value?.includes('/'))
  )
    return false;
  if ((required[category] ?? []).some((key) => !left[key] || !right[key])) return false;
  if (
    category === 'book' &&
    [left, right].some(
      (item) =>
        !/^(?:[1-9]\d*|revised)$/.test(item.edition) ||
        !/^(?:english|hindi|kannada|tamil|telugu|marathi|french|german|spanish|bengali)$/.test(
          item.language,
        ),
    )
  )
    return false;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(
    (key) => left[key] === right[key],
  );
}

/** Check digits are mandatory; ISBN is evidence of a particular publication. */
export function canonicalISBN(value: string): string | undefined {
  const digits = value.replace(/[ -]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(digits)) {
    if (
      [...digits].reduce(
        (sum, c, i) => sum + (c === 'X' ? 10 : Number(c)) * (10 - i),
        0,
      ) % 11
    )
      return;
    const prefix = '978' + digits.slice(0, 9);
    const check =
      (10 -
        ([...prefix].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) %
      10;
    return prefix + check;
  }
  if (
    /^97[89]\d{10}$/.test(digits) &&
    [...digits].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0
  )
    return digits;
}
function editionKey(value: string) {
  return normalizedValue(value)
    .replace(/^(\d+)(st|nd|rd|th)$/, '$1')
    .replace(/^first$/, '1')
    .replace(/^second$/, '2');
}
