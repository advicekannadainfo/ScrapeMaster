import { NextResponse, type NextRequest } from 'next/server';
import mongoose from 'mongoose';
import {
  authorizeEvidenceRead,
  evidenceLookupURL,
  productEvidenceSummary,
} from '@/lib/preview-product-evidence';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
const headers = { 'Cache-Control': 'private, no-store' };
/** Read-only, one existing URL. No model initialization, automatic indexes,
 * scrape/refresh imports, notifications, background work, upserts or retries. */
export async function GET(request: NextRequest) {
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
              : 'Diagnostic not configured',
      },
      { status: access, headers },
    );
  const values = request.nextUrl.searchParams.getAll('url');
  const url = values.length === 1 ? evidenceLookupURL(values[0]) : undefined;
  if (!url)
    return NextResponse.json(
      { error: 'One valid Flipkart product URL required' },
      { status: 400, headers },
    );
  if (!process.env.MONGODB_URI)
    return NextResponse.json(
      { error: 'Database diagnostic unavailable' },
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
            createdAt: 1,
            updatedAt: 1,
          },
        },
      );
    const sha = process.env.VERCEL_GIT_COMMIT_SHA;
    return NextResponse.json(
      {
        deploymentCommit: sha && /^[a-f0-9]{40}$/i.test(sha) ? sha : 'unavailable',
        ...productEvidenceSummary(record),
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: 'Database diagnostic unavailable' },
      { status: 503, headers },
    );
  } finally {
    await client?.close().catch(() => {});
  }
}
