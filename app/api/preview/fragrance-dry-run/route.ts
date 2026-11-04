import { NextResponse, type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authorizeEvidenceRead } from '@/lib/preview-product-evidence';
import { dryRunTarget, runFragranceDryRun } from '@/lib/preview-fragrance-dry-run';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store' };
/** POST only: never invoke from the product UI or an automatic page load. */
export async function POST(request: NextRequest) {
  const access = authorizeEvidenceRead(
    process.env.VERCEL_ENV,
    process.env.CRON_SECRET,
    request.headers.get('authorization'),
  );
  if (access !== 200)
    return NextResponse.json(
      {
        error:
          access === 404
            ? 'Not found'
            : access === 401
              ? 'Unauthorized'
              : 'Not configured',
      },
      { status: access, headers },
    );
  let input: unknown;
  try {
    if (request.nextUrl.search) throw new Error('No query parameters');
    input = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'One approved product URL required' },
      { status: 400, headers },
    );
  }
  const url = dryRunTarget(input);
  if (!url)
    return NextResponse.json(
      { error: 'One approved product URL required' },
      { status: 400, headers },
    );
  if (
    !process.env.MONGODB_URI ||
    !process.env.SCRAPINGDOG_API_KEY ||
    process.env.MERIDEALS_FRAGRANCE_PRODUCT_VERIFICATION === 'true'
  )
    return NextResponse.json(
      { error: 'Dry run unavailable; global hydration must remain disabled' },
      { status: 503, headers },
    );
  let client: InstanceType<typeof mongoose.mongo.MongoClient> | undefined;
  try {
    client = new mongoose.mongo.MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      retryReads: false,
      retryWrites: false,
    });
    await client.connect();
    const record = await client
      .db()
      .collection('products')
      .findOne(
        { store: 'flipkart', url },
        {
          projection: {
            _id: 0,
            title: 1,
            brand: 1,
            variant: 1,
            store: 1,
            url: 1,
            currentPrice: 1,
            currency: 1,
            isOutOfStock: 1,
            comparisonIdentityVerified: 1,
            canonicalIdentity: 1,
            priceObservation: 1,
            exactEvidence: 1,
          },
        },
      );
    if (!record)
      return NextResponse.json(
        { error: 'Stored product not found' },
        { status: 404, headers },
      );
    // Close the read connection before any potentially slow provider operations.
    await client.close();
    client = undefined;
    return NextResponse.json(await runFragranceDryRun(record), { headers });
  } catch {
    return NextResponse.json({ error: 'Dry run unavailable' }, { status: 503, headers });
  } finally {
    await client?.close().catch(() => {});
  }
}
