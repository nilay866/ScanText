import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createDownloadToken } from '@/lib/tokenStore';

export const dynamic = 'force-dynamic';

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
    const token = createDownloadToken();

    return NextResponse.json({ success: true, downloadToken: token });
  } catch (error: any) {
    console.error('Verify payment error:', error);
    return NextResponse.json(
      { error: error?.message || 'Verification failed' },
      { status: 500 }
    );
  }
}
