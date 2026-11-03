import { afterEach, describe, expect, it, vi } from 'vitest';
import real from './fixtures/flipkart-product-real.json';
import { inspectFlipkartAPIProduct } from '@/lib/scraper/stores/retail-product-json';
const url = 'https://www.flipkart.com/perfume/p/itmexample?pid=PERHHD9GPW6NNYRQ';
const parse = (body: unknown) => inspectFlipkartAPIProduct(JSON.stringify(body), url);
afterEach(() => vi.restoreAllMocks());
function missing() {
  const p = structuredClone(real);
  Reflect.deleteProperty(p.product_results.specifications.General, 'Model Name');
  return p;
}
describe('missing Flipkart Model Name structural diagnostics only', () => {
  it('logs allowlisted groups/fields/types and evidence presence while preserving rejection', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = missing();
    Object.assign(p.product_results.specifications.General, {
      'Model Number': 'PRIVATE_MODEL',
      Color: 'PRIVATE_COLOUR',
    });
    Object.assign(p.product_results.specifications, {
      'Audio Features': { 'Model ID': ['PRIVATE_ID'] },
      PRIVATE_GROUP: { 'Product Name': 'PRIVATE_NAME' },
    });
    Object.assign(p.product_results, { model_number: 'PRIVATE_ROOT_MODEL' });
    expect(parse(p).comparisonIdentityVerified).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const [prefix, summary] = warn.mock.calls[0];
    expect(prefix).toBe('[flipkart] Missing Model Name structural diagnostic');
    expect(summary.specificationGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group: 'General',
          modelFields: [{ field: 'Model Number', type: 'string' }],
        }),
        {
          group: 'Audio Features',
          type: 'object',
          modelFields: [{ field: 'Model ID', type: 'array' }],
        },
        {
          group: '[redacted group]',
          type: 'object',
          modelFields: [{ field: 'Product Name', type: 'string' }],
        },
      ]),
    );
    expect(summary.selectedColourEvidence).toMatchObject({
      titleHasRecognizedColour: false,
      general: [
        { field: 'Color', present: true, type: 'string' },
        { field: 'Colour', present: false, type: 'undefined' },
      ],
    });
    expect(summary.alternativeMainIdentity).toContainEqual({
      field: 'model_number',
      present: true,
      type: 'string',
    });
    expect(summary.alternativeMainIdentity).toContainEqual({
      field: 'sku',
      present: true,
      type: 'string',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE');
  });
  it('never logs secret values, arbitrary field names, request URLs, customer reviews or headers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = missing();
    Object.assign(p.product_results, {
      api_key: 'SENSITIVE_KEY',
      headers: { Authorization: 'SENSITIVE_TOKEN' },
      request_url: 'https://example.test/?api_key=SENSITIVE_KEY',
    });
    Object.assign(p.product_results.specifications, {
      SENSITIVE_GROUP: { SENSITIVE_CUSTOMER: 'SENSITIVE_VALUE' },
    });
    expect(parse(p).comparisonIdentityVerified).toBe(false);
    const logged = JSON.stringify(warn.mock.calls);
    for (const hidden of [
      'SENSITIVE',
      real.product_results.title,
      real.product_results.sku,
      real.product_results.main_image,
      'customer_reviews',
      'request_url',
      'headers',
      'api_key',
    ])
      expect(logged).not.toContain(hidden);
  });
  it('bounds inspection output and does not traverse variants or nested provider objects', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = missing();
    for (let i = 0; i < 30; i++)
      Object.assign(p.product_results.specifications, {
        ['PRIVATE_GROUP' + i]: Object.fromEntries(
          Array.from({ length: 100 }, (_, j) => [
            'PRIVATE_FIELD' + j,
            { value: 'PRIVATE' },
          ]),
        ),
      });
    expect(parse(p).comparisonIdentityVerified).toBe(false);
    const summary = warn.mock.calls[0][1];
    expect(summary.specificationGroups).toHaveLength(12);
    expect(summary.groupsTruncated).toBe(true);
    expect(
      summary.specificationGroups.every(
        (g: { modelFields: unknown[] }) => g.modelFields.length <= 10,
      ),
    ).toBe(true);
    expect(summary.alternativeMainIdentity.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(summary).length).toBeLessThan(5000);
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
  });
  it('does not leak prototype-like group names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = missing();
    Object.assign(p.product_results.specifications, {
      constructor: { 'Model Number': 'PRIVATE' },
    });
    expect(parse(p).comparisonIdentityVerified).toBe(false);
    expect(warn.mock.calls[0][1].specificationGroups).toContainEqual({
      group: '[redacted group]',
      type: 'object',
      modelFields: [{ field: 'Model Number', type: 'string' }],
    });
  });
  it('does not log when the model is valid, null or another unsupported non-missing representation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parse(real).variant).toBe('30ml');
    const p = missing();
    Object.assign(p.product_results.specifications.General, { 'Model Name': null });
    expect(() => parse(p)).toThrow(/observed=null/);
    expect(warn).not.toHaveBeenCalled();
  });
});
