import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

/**
 * In-memory token store.
 * In production you'd use Redis or a database, but for a single-instance
 * Next.js deployment this is perfectly fine.
 */
interface DownloadToken {
  token: string;
  createdAt: number;
  used: boolean;
}

const tokenStore = new Map<string, DownloadToken>();

// Cleanup expired tokens every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of tokenStore) {
    if (now - val.createdAt > 10 * 60 * 1000) {
      tokenStore.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Validate a download token — called by the export route.
 * Returns true and deletes the token (one-time use) if valid.
 */
export function validateAndConsumeToken(token: string): boolean {
  const entry = tokenStore.get(token);
  if (!entry) return false;
  if (entry.used) return false;
  // Tokens expire after 5 minutes
  if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
    tokenStore.delete(token);
    return false;
  }
  entry.used = true;
  tokenStore.delete(token);
  return true;
}

/**
 * POST /api/payment/verify
 *
 * Verifies the Razorpay payment signature using HMAC-SHA256.
 * On success, issues a one-time download token.
 */
export async function POST(req: NextRequest) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      await req.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: 'Missing payment verification fields' },
        { status: 400 }
      );
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: 'Server misconfiguration' },
        { status: 500 }
      );
    }

    // Verify signature: HMAC-SHA256(order_id + "|" + payment_id, secret)
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json(
        { error: 'Payment verification failed — invalid signature' },
        { status: 400 }
      );
    }

    // Payment verified — issue a one-time download token
    const token = uuidv4();
    tokenStore.set(token, {
      token,
      createdAt: Date.now(),
      used: false,
    });

    return NextResponse.json({ success: true, downloadToken: token });
  } catch (error: any) {
    console.error('Verify payment error:', error);
    return NextResponse.json(
      { error: error?.message || 'Verification failed' },
      { status: 500 }
    );
  }
}
