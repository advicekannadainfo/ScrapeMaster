'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import ProductModel from '@/lib/models/product.model';
import { generateEmailBody, sendEmail } from '@/lib/nodemailer';
import { ScrapeError } from '@/lib/scraper';
import { updateOffers, verifyAndUpdateCandidateOffers } from '@/lib/services/offers';
import { refreshProduct } from '@/lib/services/refresh';
import { findTrackedId, trackProduct } from '@/lib/services/track';
import { isValidProductURL } from '@/lib/utils';
import type { ActionResult } from '@/types';
import { parseDryRunRequest } from '@/lib/preview-fragrance-dry-run';
import {
  createPreviewTrackingBudget,
  previewWebsiteTestEnabled,
} from '@/lib/scraper/preview-provider-budget';

const urlSchema = z
  .string()
  .trim()
  .min(1, 'Paste a product link')
  .max(2048, 'That link is too long')
  .refine(isValidProductURL, 'That does not look like a product page link');

export async function scrapeAndStoreProduct(
  input: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = urlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    const bounded = previewWebsiteTestEnabled();
    const approved = bounded ? parseDryRunRequest({ url: parsed.data }) : undefined;
    if (bounded && !approved)
      return { ok: false, error: 'Only the approved Preview test URL is allowed.' };
    const budget = bounded ? createPreviewTrackingBudget() : undefined;
    const { id } = budget
      ? await budget.track(() => trackProduct(approved!.url))
      : await trackProduct(parsed.data);
    // Compare other stores after responding so tracking stays fast.
    after(async () => {
      if (budget) {
        try {
          await budget.compare(() => updateOffers(id));
        } catch {
          console.warn('[preview-tracking] Comparison unavailable');
        } finally {
          console.info('[preview-tracking] Provider attempts', budget.summary());
        }
      } else
        await updateOffers(id).catch((error) =>
          console.error('[actions] offers failed', error),
        );
    });

    revalidatePath('/');
    revalidatePath(`/products/${id}`);
    return { ok: true, data: { id } };
  } catch (error) {
    console.error('[actions] scrapeAndStoreProduct failed', error);
    const message =
      error instanceof ScrapeError
        ? error.message
        : 'Something went wrong. Please try again.';
    return { ok: false, error: message };
  }
}

/**
 * Open a store listing inside the app: returns the tracked product if it
 * exists, otherwise tracks it first. Used when clicking store listings.
 */
export async function openProduct(input: string): Promise<ActionResult<{ id: string }>> {
  const parsed = urlSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  try {
    const existing = await findTrackedId(parsed.data);
    if (existing) return { ok: true, data: { id: existing } };
  } catch {
    // Fall through to tracking, which reports its own errors.
  }
  return scrapeAndStoreProduct(parsed.data);
}

const trackSchema = z.object({
  productId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid product'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

export async function addUserEmailToProduct(
  productId: string,
  email: string,
): Promise<ActionResult<{ alreadyTracking: boolean }>> {
  const parsed = trackSchema.safeParse({ productId, email });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    await connectDB();
    const { productId: id, email: address } = parsed.data;

    // Atomic conditional push: concurrent submits can't store the same email twice.
    const product = await ProductModel.findOneAndUpdate(
      { _id: id, 'users.email': { $ne: address } },
      { $push: { users: { email: address } } },
      { new: true, projection: 'title url image currency currentPrice' },
    ).lean();

    if (!product) {
      const exists = await ProductModel.exists({ _id: id });
      if (!exists) return { ok: false, error: 'Product not found' };
      return { ok: true, data: { alreadyTracking: true } };
    }

    const content = generateEmailBody(
      {
        title: product.title,
        url: product.url,
        image: product.image,
        currency: product.currency,
        currentPrice: product.currentPrice,
      },
      'WELCOME',
    );
    await sendEmail(content, [address], id).catch((error) =>
      console.error('[actions] welcome email failed', error),
    );

    return { ok: true, data: { alreadyTracking: false } };
  } catch (error) {
    console.error('[actions] addUserEmailToProduct failed', error);
    return { ok: false, error: 'Could not save your email. Please try again.' };
  }
}

const REFRESH_COOLDOWN_MS = 60_000;

/** Re-check a product's price right now, rate-limited per product. */
export async function refreshProductNow(
  productId: string,
): Promise<ActionResult<{ changed: boolean }>> {
  if (!/^[a-f\d]{24}$/i.test(productId)) return { ok: false, error: 'Invalid product' };

  try {
    await connectDB();
    const product = await ProductModel.findById(productId)
      .select('updatedAt currentPrice')
      .lean();
    if (!product) return { ok: false, error: 'Product not found' };

    const age = Date.now() - new Date(product.updatedAt).getTime();
    if (age < REFRESH_COOLDOWN_MS) {
      return {
        ok: false,
        error: `Checked moments ago. Try again in ${Math.ceil((REFRESH_COOLDOWN_MS - age) / 1000)}s.`,
      };
    }

    const result = await refreshProduct(productId);
    if (result.status !== 'updated')
      return { ok: false, error: 'Could not read the latest price.' };

    revalidatePath('/');
    revalidatePath(`/products/${productId}`);
    return { ok: true, data: { changed: result.currentPrice !== product.currentPrice } };
  } catch (error) {
    console.error('[actions] refreshProductNow failed', error);
    const message =
      error instanceof ScrapeError ? error.message : 'Refresh failed. Please try again.';
    return { ok: false, error: message };
  }
}

const COMPARE_COOLDOWN_MS = 10 * 60_000;

/** Search other stores for the same product, at most every 10 minutes. */
export async function compareOffersNow(
  productId: string,
): Promise<ActionResult<{ count: number }>> {
  if (!/^[a-f\d]{24}$/i.test(productId)) return { ok: false, error: 'Invalid product' };

  try {
    await connectDB();
    const product = await ProductModel.findById(productId)
      .select('offersCheckedAt')
      .lean();
    if (!product) return { ok: false, error: 'Product not found' };

    const age = product.offersCheckedAt
      ? Date.now() - new Date(product.offersCheckedAt).getTime()
      : Infinity;
    if (age < COMPARE_COOLDOWN_MS) {
      return { ok: false, error: 'Compared recently. Try again in a few minutes.' };
    }

    const offers = await updateOffers(productId);
    revalidatePath(`/products/${productId}`);
    return { ok: true, data: { count: offers.length } };
  } catch (error) {
    console.error('[actions] compareOffersNow failed', error);
    return { ok: false, error: 'Could not compare stores right now.' };
  }
}

const MANUAL_COMPARE_COOLDOWN_MS = 10 * 60_000;

/** Manual product URLs use a separate persisted cooldown to protect paid credits. */
export async function verifyProductLinksNow(
  productId: string,
  candidateLinks: string[],
): Promise<ActionResult<{ count: number; verified: number; statuses: string[] }>> {
  if (!/^[a-f\d]{24}$/i.test(productId)) return { ok: false, error: 'Invalid product' };
  if (
    !Array.isArray(candidateLinks) ||
    candidateLinks.length < 1 ||
    candidateLinks.length > 2 ||
    candidateLinks.some((link) => {
      if (typeof link !== 'string' || link.length > 2048 || !isValidProductURL(link))
        return true;
      try {
        const u = new URL(link);
        return (
          u.protocol !== 'https:' ||
          Boolean(u.username || u.password || u.port) ||
          !/^(www\.)?(amazon\.in|flipkart\.com|myntra\.com)$/.test(u.hostname)
        );
      } catch {
        return true;
      }
    })
  )
    return { ok: false, error: 'Enter one or two valid HTTPS product links.' };
  try {
    await connectDB();
    const now = new Date();
    // Atomic reservation: concurrent clicks cannot trigger duplicate paid calls.
    const claimed = await ProductModel.findOneAndUpdate(
      {
        _id: productId,
        $or: [
          { candidateLinksCheckedAt: { $exists: false } },
          {
            candidateLinksCheckedAt: {
              $lt: new Date(now.getTime() - MANUAL_COMPARE_COOLDOWN_MS),
            },
          },
        ],
      },
      { $set: { candidateLinksCheckedAt: now } },
      { projection: { _id: 1 } },
    ).lean();
    if (!claimed) {
      if (!(await ProductModel.exists({ _id: productId })))
        return { ok: false, error: 'Product not found' };
      return {
        ok: false,
        error: 'Product links checked recently. Try again in 10 minutes.',
      };
    }
    const result = await verifyAndUpdateCandidateOffers(productId, candidateLinks);
    if (result.verified) revalidatePath(`/products/${productId}`);
    return {
      ok: true,
      data: {
        count: result.offers.length,
        verified: result.verified,
        statuses: result.diagnostics.map((d) => `${d.store}: ${d.status}`),
      },
    };
  } catch (error) {
    console.error('[actions] verifyProductLinksNow failed', error);
    return {
      ok: false,
      error: 'Could not verify product links. Existing offers are unchanged.',
    };
  }
}
