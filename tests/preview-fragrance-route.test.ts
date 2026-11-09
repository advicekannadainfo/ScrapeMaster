import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  Client: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  findOne: vi.fn(),
  run: vi.fn(),
  write: vi.fn(),
}));
vi.mock('mongoose', () => ({ default: { mongo: { MongoClient: mocks.Client } } }));
vi.mock('@/lib/preview-fragrance-dry-run', async (original) => ({
  ...(await original<typeof import('@/lib/preview-fragrance-dry-run')>()),
  runFragranceDryRun: mocks.run,
}));
import { POST } from '@/app/api/preview/fragrance-dry-run/route';
import { DRY_RUN_URL, DRY_RUN_INPUT_URL } from '@/lib/preview-fragrance-dry-run';
import { NextRequest } from 'next/server';
const request = (
  body: unknown = { url: DRY_RUN_URL },
  authorization = 'Bearer offline-secret',
) =>
  new NextRequest('https://preview.example/api/preview/fragrance-dry-run', {
    method: 'POST',
    headers: { authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('CRON_SECRET', 'offline-secret');
  vi.stubEnv('MONGODB_URI', 'offline-uri');
  vi.stubEnv('SCRAPINGDOG_API_KEY', 'offline-key');
  vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'false');
  mocks.Client.mockImplementation(() => ({
    connect: mocks.connect,
    close: mocks.close,
    db: () => ({
      collection: () => ({
        findOne: mocks.findOne,
        insertOne: mocks.write,
        updateOne: mocks.write,
        deleteOne: mocks.write,
        createIndex: mocks.write,
      }),
    }),
  }));
  mocks.close.mockResolvedValue(undefined);
  mocks.findOne.mockResolvedValue({ title: 'PRIVATE_DATA' });
  mocks.run.mockResolvedValue({ budget: { used: 0 } });
});
afterEach(() => vi.unstubAllEnvs());
describe('protected Preview POST: one native projected read, no business-record writes', () => {
  it.each(['production', 'development', ''])(
    'denies %s before DB/provider access',
    async (env) => {
      vi.stubEnv('VERCEL_ENV', env);
      expect((await POST(request())).status).toBe(404);
      expect(mocks.Client).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
  it('requires configured correct bearer auth', async () => {
    expect((await POST(request(undefined, 'Bearer wrong'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await POST(request())).status).toBe(503);
    expect(mocks.Client).not.toHaveBeenCalled();
  });
  it.each([
    { url: 'https://evil.example' },
    { url: [DRY_RUN_URL] },
    { url: DRY_RUN_URL, extra: 'bad' },
    {},
    { url: `${DRY_RUN_INPUT_URL}&lid=UNAPPROVED` },
    { url: DRY_RUN_URL.replace('PERHHHH3RYADXXH5', 'UNAPPROVEDPID') },
    { url: DRY_RUN_URL, mode: 'myntra-only' },
    { url: DRY_RUN_URL, mode: 'amazon-only', maximum: 10 },
    { url: 'https://evil.example', mode: 'amazon-only' },
  ])('rejects non-single or unapproved target %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.Client).not.toHaveBeenCalled();
  });
  it('requires the global flag to remain disabled', async () => {
    vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'true');
    expect((await POST(request())).status).toBe(503);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('reads only one stored record and closes the connection before ephemeral comparison', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
    expect(mocks.findOne.mock.calls[0][0]).toEqual({
      store: 'flipkart',
      url: DRY_RUN_URL,
    });
    expect(mocks.findOne.mock.calls[0][1].projection).not.toHaveProperty('users');
    expect(mocks.Client.mock.calls[0][1]).toMatchObject({
      retryWrites: false,
      retryReads: false,
    });
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.run.mock.invocationCallOrder[0],
    );
    expect(mocks.write).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('maps the approved short POST input to the exact full stored URL with one read', async () => {
    const stored = { title: 'PRIVATE_DATA', store: 'flipkart', url: DRY_RUN_URL };
    mocks.findOne.mockImplementation(async (filter) =>
      filter.url === DRY_RUN_URL ? stored : null,
    );
    const response = await POST(request({ url: DRY_RUN_INPUT_URL }));
    expect(response.status).toBe(200);
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
    expect(mocks.findOne.mock.calls[0][0]).toEqual({
      store: 'flipkart',
      url: DRY_RUN_URL,
    });
    expect(DRY_RUN_URL).toBe(
      `${DRY_RUN_INPUT_URL}&lid=LSTPERHHHH3RYADXXH5O3A3JX&marketplace=FLIPKART&cmpid=content_perfume_8965229628_gmc`,
    );
    expect(mocks.run).toHaveBeenCalledWith(stored, 'all');
    expect(stored.url).toBe(DRY_RUN_URL);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not create missing records and redacts database/provider errors', async () => {
    mocks.findOne.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.run).not.toHaveBeenCalled();
    mocks.findOne.mockResolvedValue({});
    mocks.run.mockRejectedValue(new Error('PRIVATE api_key=secret'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/PRIVATE|api_key|secret/);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('binds Amazon-only short input to the exact stored URL with one read and no writes', async () => {
    const stored = { title: 'PRIVATE_DATA', store: 'flipkart', url: DRY_RUN_URL };
    mocks.findOne.mockResolvedValue(stored);
    const response = await POST(request({ url: DRY_RUN_INPUT_URL, mode: 'amazon-only' }));
    expect(response.status).toBe(200);
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
    expect(mocks.findOne).toHaveBeenCalledWith(
      { store: 'flipkart', url: DRY_RUN_URL },
      expect.objectContaining({ projection: expect.objectContaining({ _id: 0 }) }),
    );
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(stored, 'amazon-only');
    expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.run.mock.invocationCallOrder[0],
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('keeps Amazon-only authentication, Preview and global-flag restrictions ahead of DB/provider access', async () => {
    const body = { url: DRY_RUN_INPUT_URL, mode: 'amazon-only' };
    expect((await POST(request(body, 'Bearer wrong'))).status).toBe(401);
    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await POST(request(body))).status).toBe(404);
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION', 'true');
    expect((await POST(request(body))).status).toBe(503);
    expect(mocks.Client).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
