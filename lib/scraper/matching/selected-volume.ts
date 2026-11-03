/** Only validated MAIN Product responses belong here. Callers must first verify
 * URL/product ID, selected seller/SKU and root price/stock through the adapter.
 * This resolver never reads titles, alternative sizes or per-unit pricing. */
export const selectedVolumeFields = {
  amazon: ['product_information.Item Volume', 'product_information.Package Size Name'],
  flipkart: [
    'specifications.General.Quantity',
    'specifications.General.Net Quantity',
    'specifications.Product Highlights.Quantity',
    'product_results.highlights.Quantity',
  ],
  'myntra.com': ['selectedSeller.netQuantity'],
} as const;
export function volumeMl(value: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\s*$/i.exec(
    value,
  );
  if (!m) return;
  const n = Number(m[1]) * (/^(l|lit)/i.test(m[2]) ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export type VolumeResolution = {
  status: 'verified' | 'missing' | 'unsupported' | 'conflict';
  volume?: number;
  field?: string;
  fields: string[];
};
export function resolveSelectedVolume(store: string, body: unknown): VolumeResolution {
  const raw = object(body),
    root = store === 'amazon' ? raw : object(raw.product_results);
  const entries: { field: string; value: unknown }[] = [];
  let unsupported = false;
  const add = (field: string, value: unknown) => {
    if (value !== undefined && value !== null) entries.push({ field, value });
  };
  if (store === 'amazon') {
    const info = object(root.product_information);
    add(selectedVolumeFields.amazon[0], info['Item Volume']);
    add(selectedVolumeFields.amazon[1], info['Package Size Name']);
  } else if (store === 'flipkart') {
    const specs = object(root.specifications),
      general = object(specs.General);
    add(selectedVolumeFields.flipkart[0], general.Quantity);
    add(selectedVolumeFields.flipkart[1], general['Net Quantity']);
    add(selectedVolumeFields.flipkart[2], object(specs['Product Highlights']).Quantity);
    if (Array.isArray(root.highlights)) {
      if (root.highlights.length > 50) unsupported = true;
      for (const text of root.highlights.slice(0, 50)) {
        if (typeof text !== 'string') continue;
        const m = /^Quantity:\s*(.+)$/i.exec(text.trim());
        if (m) add(selectedVolumeFields.flipkart[3], m[1]);
      }
    }
  } else if (store === 'myntra.com') {
    const quantities = object(root.selectedSeller).netQuantity;
    if (quantities !== undefined && quantities !== null) {
      if (!Array.isArray(quantities) || quantities.length > 20) unsupported = true;
      else
        for (const item of quantities) {
          const q = object(item);
          if (q.type !== undefined && q.type !== 'single') unsupported = true;
          add(
            selectedVolumeFields['myntra.com'][0],
            typeof q.unit === 'string' &&
              (typeof q.quantity === 'number' || typeof q.quantity === 'string')
              ? `${q.quantity} ${q.unit}`
              : {},
          );
        }
    }
  }
  const fields = [...new Set(entries.map((e) => e.field))];
  const values = entries.map((e) =>
    typeof e.value === 'string' ? volumeMl(e.value) : undefined,
  );
  if (values.some((v) => v === undefined)) unsupported = true;
  if (new Set(values.filter((v) => v !== undefined)).size > 1)
    return { status: 'conflict', fields };
  if (unsupported) return { status: 'unsupported', fields };
  if (!values.length) return { status: 'missing', fields };
  return { status: 'verified', volume: values[0], field: entries[0].field, fields };
}
