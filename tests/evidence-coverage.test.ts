import { describe, it, expect } from 'vitest';
import snapshot from '../docs/evidence-coverage.json';
import { buildEvidenceCoverage } from './support/evidence-coverage';

describe('release evidence inventory (captured vs documented, never synthetic live claims)', () => {
  it('reproduces the committed measurable report from unmodified fixtures', () => {
    expect(buildEvidenceCoverage()).toEqual(snapshot);
  });
  it('accounts for all 18 cells and never promotes missing categories to passing', () => {
    const report = buildEvidenceCoverage();
    expect(report.summary).toEqual({
      categoryStoreCells: 18,
      capturedProductFixtures: 3,
      capturedCategoryStoreCells: 3,
      releaseReadyCategories: 0,
    });
    for (const row of report.rows.filter((r) => r.category !== 'fragrance')) {
      expect(row.capturedProductFixtures).toBe(0);
      expect(row.canonicalProfile).toBe('not-enabled');
      expect(row.exactReleaseStatus).toBe('unsupported-for-category-wide-release');
    }
  });
  it('records the documented monitor blocker and selected-size gap honestly', () => {
    const report = buildEvidenceCoverage();
    expect(
      report.fixtures.find((f) => f.file === 'flipkart-product-full.json')?.tracking,
    ).toBe('blocked-contract');
    expect(report.fixtures.find((f) => f.file === 'myntra-product.json')).toMatchObject({
      tracking: 'pass',
      independentIdentity: false,
      selectedFields: [],
    });
    expect(report.searches.every((s) => !s.establishesSelectedSku)).toBe(true);
  });
  it('reports structural coverage only, without titles, URLs, prices or timestamps', () => {
    expect(JSON.stringify(buildEvidenceCoverage())).not.toMatch(
      /https?:|Love Drunk|Old Money|₹|observedAt|api_key/,
    );
  });
});
