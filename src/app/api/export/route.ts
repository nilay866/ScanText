import { NextRequest, NextResponse } from 'next/server';
import { validateAndConsumeToken } from '@/lib/tokenStore';

export const dynamic = 'force-dynamic';

/**
 * POST /api/export
 *
 * Receives a base64-encoded image from the client canvas and returns it as a
 * proper binary file download with correct Content-Type and
 * Content-Disposition headers.
 *
 * Requires a valid one-time downloadToken from the payment verification step.
 *
 * Body (JSON):
 *   imageBase64    – data-URL string, e.g. "data:image/png;base64,iVBOR…"
 *   filename       – desired download name, e.g. "scantext-edited.png"
 *   mimeType       – "image/png" | "image/jpeg"
 *   downloadToken  – one-time token from /api/payment/verify
 */
export async function POST(req: NextRequest) {
  try {
    const { imageBase64, filename, mimeType, downloadToken } = await req.json();

    // ── Validate download token ───────────────────────────────────────
    if (!downloadToken) {
      return NextResponse.json(
        { error: 'Payment required. Please complete the payment to download.' },
        { status: 402 }
      );
    }

    if (!validateAndConsumeToken(downloadToken)) {
      return NextResponse.json(
        { error: 'Invalid or expired download token. Please pay again.' },
        { status: 403 }
      );
    }

    // ── Build the image response ──────────────────────────────────────
    if (!imageBase64) {
      return NextResponse.json(
        { error: 'imageBase64 is required' },
        { status: 400 }
      );
    }

    const safeMime =
      mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const safeName = (filename || 'scantext-edited.png').replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );

    // Strip the data-URL prefix ("data:image/png;base64,") if present
    const raw = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': safeMime,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Export API error:', error);
    return NextResponse.json(
      { error: error?.message || 'Export failed' },
      { status: 500 }
    );
  }
}
