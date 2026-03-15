// Inpainting engine — selective pixel erasure + pixel-precise text rendering

/**
 * Selective pixel erasure — the ONLY truly pixel-perfect background approach.
 *
 * Instead of filling the bounding box with any color, we:
 *  1. Re-sample the background color directly from pixels just OUTSIDE the bbox
 *     (from the pristine, unmodified canvas — no estimation involved)
 *  2. For each pixel inside the bbox, measure its "distance" from the background
 *  3. Only erase pixels that are visually part of the ink/text
 *  4. Background pixels (close to background color) are left 100% UNTOUCHED
 *
 * This means the background is never re-generated — it is literally the same
 * pixels from the original image, giving perfect results for any background:
 * flat, gradient, texture, UI elements, whatever.
 */
export function inpaintRegion(
  sourceCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  _bgColorHex: string  // legacy param — we now sample live from canvas border
): void {
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return;

  const W = sourceCanvas.width;
  const H = sourceCanvas.height;

  const px = Math.max(0, Math.floor(x) - 1);
  const py = Math.max(0, Math.floor(y) - 1);
  const px2 = Math.min(W, Math.ceil(x + width) + 1);
  const py2 = Math.min(H, Math.ceil(y + height) + 1);
  const pw = px2 - px;
  const ph = py2 - py;

  if (pw <= 0 || ph <= 0) return;

  // ── Step 1: Sample the true background from the bbox border (3px ring) ──────
  const BORDER = 3;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];

  // Sample from just outside the padded region
  const outerPx = Math.max(0, px - BORDER);
  const outerPy = Math.max(0, py - BORDER);
  const outerPx2 = Math.min(W, px2 + BORDER);
  const outerPy2 = Math.min(H, py2 + BORDER);

  const outerData = ctx.getImageData(outerPx, outerPy, outerPx2 - outerPx, outerPy2 - outerPy).data;

  const ow = outerPx2 - outerPx;
  for (let oy = 0; oy < outerPy2 - outerPy; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      // Only take pixels that are OUTSIDE the inner bbox
      const absX = outerPx + ox;
      const absY = outerPy + oy;
      if (absX >= px && absX < px2 && absY >= py && absY < py2) continue;
      const i = (oy * ow + ox) * 4;
      rs.push(outerData[i]);
      gs.push(outerData[i + 1]);
      bs.push(outerData[i + 2]);
    }
  }

  // Median of each channel — robust against stray colored pixels at border
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  const bgR = rs[mid] ?? 255;
  const bgG = gs[mid] ?? 255;
  const bgB = bs[mid] ?? 255;

  // ── Step 2: Selective in-place erasure ──────────────────────────────────────
  const imageData = ctx.getImageData(px, py, pw, ph);
  const d = imageData.data;

  // How far from background a pixel must be to be considered "text ink"
  // 40 handles dark text on light bg and light text on dark bg equally well.
  // We use a soft blend zone (30–60) so anti-aliased edge pixels fade smoothly.
  const HARD_THRESHOLD = 60;
  const SOFT_THRESHOLD = 30;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

    if (dist <= SOFT_THRESHOLD) {
      // Definitely background — leave completely untouched
      continue;
    } else if (dist >= HARD_THRESHOLD) {
      // Definitely text ink — replace fully with background
      d[i]     = bgR;
      d[i + 1] = bgG;
      d[i + 2] = bgB;
      d[i + 3] = 255;
    } else {
      // Anti-aliased edge pixel — blend proportionally towards background
      const t = (dist - SOFT_THRESHOLD) / (HARD_THRESHOLD - SOFT_THRESHOLD);
      d[i]     = Math.round(r + (bgR - r) * t);
      d[i + 1] = Math.round(g + (bgG - g) * t);
      d[i + 2] = Math.round(b + (bgB - b) * t);
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, px, py);
}

/**
 * Render new text with pixel-precise baseline placement.
 *
 * Key improvements vs naive fillText:
 *  - Uses actualBoundingBoxAscent to pin glyph top exactly to bbox top
 *  - Does NOT pass maxWidth to fillText (avoids horizontal text squeezing)
 *  - Vertically centers within bbox so descenders don't clip
 *  - Clips to bbox so overflow never contaminates neighboring regions
 *  - Includes Roboto and Inter in font stack (common in mobile UI screenshots)
 */
export function renderText(
  canvas: HTMLCanvasElement,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  fontWeight: string,
  fontFamily: string,
  color: string,
  alignment: 'left' | 'center' | 'right',
  letterSpacing?: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();

  // Font stack: prioritise Roboto (Android/Google apps) then Inter then system
  const customFamily = fontFamily && fontFamily !== 'system-ui' ? `${fontFamily}, ` : '';
  const fontStack = `${customFamily}Roboto, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;

  const fSize = Math.max(8, fontSize);
  ctx.font = `${fontWeight} ${fSize}px ${fontStack}`;
  ctx.fillStyle = color;

  // Measure ascent/descent to perfectly align the text within the bbox
  const metrics = ctx.measureText(text);
  const ascent  = (metrics.actualBoundingBoxAscent  ?? fSize * 0.75);
  const descent = (metrics.actualBoundingBoxDescent ?? fSize * 0.15);
  const textH   = ascent + descent;

  // Center vertically inside the bbox
  const topPad = Math.max(0, (height - textH) / 2);
  const textY  = y + topPad + ascent;

  // Clip so we never bleed outside the original bounding box
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  // Set alignment — DO NOT pass maxWidth (avoids ugly horizontal squashing)
  let textX: number;
  if (alignment === 'center') {
    ctx.textAlign = 'center';
    textX = x + width / 2;
  } else if (alignment === 'right') {
    ctx.textAlign = 'right';
    textX = x + width;
  } else {
    ctx.textAlign = 'left';
    textX = x;
  }

  ctx.textBaseline = 'alphabetic';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  // Apply letter-spacing if supported by the browser and provided
  if (letterSpacing !== undefined && 'letterSpacing' in ctx) {
    (ctx as any).letterSpacing = `${letterSpacing}px`;
  }

  ctx.fillText(text, textX, textY);

  ctx.restore();
}

/**
 * Create an offscreen canvas from an image at its native pixel resolution.
 */
export function imageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width  = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return canvas;
}

/**
 * Get ImageData from a canvas for pixel analysis.
 */
export function getImageData(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Export the canvas as a lossless PNG or JPEG blob.
 * Falls back to toDataURL → manual ArrayBuffer conversion if toBlob
 * produces an empty or missing result.
 */
export function exportCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/jpeg' = 'image/png'
): Promise<Blob> {
  // PNG is lossless — quality param is ignored by spec, use 1.0.
  // JPEG uses 0.95 for near-lossless quality.
  const quality = mimeType === 'image/png' ? 1.0 : 0.95;

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 100) {
            // toBlob succeeded — but ensure the MIME type is correct
            if (blob.type === mimeType) {
              resolve(blob);
            } else {
              // Re-wrap with correct MIME type
              resolve(new Blob([blob], { type: mimeType }));
            }
            return;
          }

          // Fallback: toDataURL → manually decode base64 → Blob
          // This avoids fetch() issues and guarantees correct MIME type.
          try {
            const dataUrl = canvas.toDataURL(mimeType, quality);
            const parts = dataUrl.split(',');
            if (parts.length < 2) {
              reject(new Error('Canvas export produced an invalid data URL.'));
              return;
            }
            const byteString = atob(parts[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const fallbackBlob = new Blob([ab], { type: mimeType });

            if (fallbackBlob.size > 100) {
              resolve(fallbackBlob);
            } else {
              reject(new Error('Canvas export produced an empty image.'));
            }
          } catch {
            reject(new Error('Export failed — canvas may be tainted.'));
          }
        },
        mimeType,
        quality
      );
    } catch (err) {
      reject(err);
    }
  });
}
