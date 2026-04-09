/**
 * Inpainting Engine v2 — Pixel-perfect background reconstruction + calibrated text rendering.
 *
 * INPAINTING:
 *   - Gradient-aware: samples all 4 edges independently and bilinearly interpolates
 *   - Edge feathering: 2px soft blend at bbox boundaries
 *   - Background pixels left 100% untouched (selective erasure)
 *
 * TEXT RENDERING:
 *   - Binary-search font size calibration — renders until pixel-width matches bbox
 *   - Letter-spacing calibration — distributes remaining width delta across characters
 *   - Uses platform-detected fonts from fontLoader
 *   - Sub-pixel baseline positioning via actualBoundingBoxAscent
 */

import { getFontStack } from './fontLoader';

// ── Gradient-Aware Inpainting ─────────────────────────────────────────────────

/**
 * Erase text pixels from the canvas and reconstruct the background using
 * bilinear interpolation from the 4 edge strips.
 *
 * This handles:
 *  - Flat backgrounds (trivial)
 *  - Vertical gradients (notification panels, dark mode)
 *  - Horizontal gradients (some chat bubbles)
 *  - Diagonal gradients (blended via bilinear)
 */
export function inpaintRegion(
  sourceCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  _bgColorHex: string  // legacy param — kept for API compat
): void {
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return;

  const W = sourceCanvas.width;
  const H = sourceCanvas.height;

  // Integer pixel bounds with 1px padding
  const px = Math.max(0, Math.floor(x) - 1);
  const py = Math.max(0, Math.floor(y) - 1);
  const px2 = Math.min(W, Math.ceil(x + width) + 1);
  const py2 = Math.min(H, Math.ceil(y + height) + 1);
  const pw = px2 - px;
  const ph = py2 - py;

  if (pw <= 0 || ph <= 0) return;

  // ── Step 1: Sample edge strips for gradient reconstruction ──────────────

  const BORDER = 4; // strip width to sample from

  // Sample outer border strips (outside the bbox)
  const outerPx = Math.max(0, px - BORDER);
  const outerPy = Math.max(0, py - BORDER);
  const outerPx2 = Math.min(W, px2 + BORDER);
  const outerPy2 = Math.min(H, py2 + BORDER);

  const fullData = ctx.getImageData(outerPx, outerPy, outerPx2 - outerPx, outerPy2 - outerPy);
  const fd = fullData.data;
  const fw = outerPx2 - outerPx;

  // Build edge color arrays: top row, bottom row, left column, right column
  // Each entry is the median color for that position along the edge
  function getPixel(absX: number, absY: number): [number, number, number] {
    const lx = absX - outerPx;
    const ly = absY - outerPy;
    if (lx < 0 || ly < 0 || lx >= fw || ly >= (outerPy2 - outerPy)) return [128, 128, 128];
    const i = (ly * fw + lx) * 4;
    return [fd[i], fd[i + 1], fd[i + 2]];
  }

  // Top edge: one color per column, sampled from the strip above the bbox
  const topColors: Array<[number, number, number]> = [];
  for (let cx = px; cx < px2; cx++) {
    const samples: Array<[number, number, number]> = [];
    for (let sy = Math.max(0, py - BORDER); sy < py; sy++) {
      samples.push(getPixel(cx, sy));
    }
    topColors.push(medianRGB(samples));
  }

  // Bottom edge
  const bottomColors: Array<[number, number, number]> = [];
  for (let cx = px; cx < px2; cx++) {
    const samples: Array<[number, number, number]> = [];
    for (let sy = py2; sy < Math.min(H, py2 + BORDER); sy++) {
      samples.push(getPixel(cx, sy));
    }
    bottomColors.push(medianRGB(samples));
  }

  // Left edge
  const leftColors: Array<[number, number, number]> = [];
  for (let cy = py; cy < py2; cy++) {
    const samples: Array<[number, number, number]> = [];
    for (let sx = Math.max(0, px - BORDER); sx < px; sx++) {
      samples.push(getPixel(sx, cy));
    }
    leftColors.push(medianRGB(samples));
  }

  // Right edge
  const rightColors: Array<[number, number, number]> = [];
  for (let cy = py; cy < py2; cy++) {
    const samples: Array<[number, number, number]> = [];
    for (let sx = px2; sx < Math.min(W, px2 + BORDER); sx++) {
      samples.push(getPixel(sx, cy));
    }
    rightColors.push(medianRGB(samples));
  }

  // ── Step 2: Selective erasure with gradient-aware fill ───────────────────

  const imageData = ctx.getImageData(px, py, pw, ph);
  const d = imageData.data;

  // Compute the global median background color for ink detection threshold
  const allEdge: Array<[number, number, number]> = [
    ...topColors, ...bottomColors, ...leftColors, ...rightColors
  ];
  const globalBg = medianRGB(allEdge);
  const bgR = globalBg[0], bgG = globalBg[1], bgB = globalBg[2];

  const HARD_THRESHOLD = 55;
  const SOFT_THRESHOLD = 25;

  for (let localY = 0; localY < ph; localY++) {
    for (let localX = 0; localX < pw; localX++) {
      const i = (localY * pw + localX) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];

      // Distance from background
      const dist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

      if (dist <= SOFT_THRESHOLD) {
        // Definitely background — leave untouched
        continue;
      }

      // This pixel is ink (or anti-aliased edge) — replace with interpolated background

      // Bilinear interpolation from 4 edges
      const tx = pw > 1 ? localX / (pw - 1) : 0.5; // 0 = left edge, 1 = right edge
      const ty = ph > 1 ? localY / (ph - 1) : 0.5; // 0 = top edge, 1 = bottom edge

      // Get edge colors at this position
      const topIdx = Math.min(localX, topColors.length - 1);
      const botIdx = Math.min(localX, bottomColors.length - 1);
      const leftIdx = Math.min(localY, leftColors.length - 1);
      const rightIdx = Math.min(localY, rightColors.length - 1);

      const topC = topColors[topIdx] || globalBg;
      const botC = bottomColors[botIdx] || globalBg;
      const leftC = leftColors[leftIdx] || globalBg;
      const rightC = rightColors[rightIdx] || globalBg;

      // Bilinear: interpolate vertically (top↔bottom) and horizontally (left↔right)
      // then average both results for smooth gradient reconstruction
      const vertR = topC[0] * (1 - ty) + botC[0] * ty;
      const vertG = topC[1] * (1 - ty) + botC[1] * ty;
      const vertB = topC[2] * (1 - ty) + botC[2] * ty;

      const horizR = leftC[0] * (1 - tx) + rightC[0] * tx;
      const horizG = leftC[1] * (1 - tx) + rightC[1] * tx;
      const horizB = leftC[2] * (1 - tx) + rightC[2] * tx;

      const fillR = (vertR + horizR) / 2;
      const fillG = (vertG + horizG) / 2;
      const fillB = (vertB + horizB) / 2;

      if (dist >= HARD_THRESHOLD) {
        // Definitely ink — replace fully
        d[i]     = Math.round(fillR);
        d[i + 1] = Math.round(fillG);
        d[i + 2] = Math.round(fillB);
        d[i + 3] = 255;
      } else {
        // Anti-aliased edge — blend proportionally
        const t = (dist - SOFT_THRESHOLD) / (HARD_THRESHOLD - SOFT_THRESHOLD);
        d[i]     = Math.round(r + (fillR - r) * t);
        d[i + 1] = Math.round(g + (fillG - g) * t);
        d[i + 2] = Math.round(b + (fillB - b) * t);
        d[i + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, px, py);
}

// ── Calibrated Text Rendering ─────────────────────────────────────────────────

/**
 * Render text with pixel-perfect calibration.
 *
 * Pipeline:
 *  1. Set font family from platform detection
 *  2. Binary-search font size until rendered width ≈ original bbox width (±1px)
 *  3. Compute and apply letter-spacing to absorb remaining width delta
 *  4. Position baseline using actualBoundingBoxAscent
 *  5. Clip to bbox and render
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
  _fontFamily: string,  // ignored — we use platform-detected font
  color: string,
  alignment: 'left' | 'center' | 'right',
  letterSpacing?: number
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (text.trim().length === 0) return;

  const fontStack = getFontStack();

  ctx.save();

  // ── Step 1: Binary-search font size calibration ─────────────────────────

  let calibratedSize = fontSize;
  let lo = fontSize * 0.5;
  let hi = fontSize * 1.8;

  // 12 iterations of binary search → precision of ~0.05px
  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) / 2;
    ctx.font = `${fontWeight} ${mid}px ${fontStack}`;
    const measured = ctx.measureText(text).width;

    if (Math.abs(measured - width) < 0.5) {
      // Close enough — done
      calibratedSize = mid;
      break;
    }

    if (measured < width) {
      lo = mid;
    } else {
      hi = mid;
    }
    calibratedSize = mid;
  }

  // Ensure minimum
  calibratedSize = Math.max(6, calibratedSize);

  // ── Step 2: Set final font and measure ──────────────────────────────────

  ctx.font = `${fontWeight} ${calibratedSize}px ${fontStack}`;
  const finalMetrics = ctx.measureText(text);
  const renderedWidth = finalMetrics.width;

  // ── Step 3: Letter-spacing calibration ──────────────────────────────────

  let computedLetterSpacing = letterSpacing ?? 0;

  if (text.length > 1) {
    const widthDelta = width - renderedWidth;
    // Distribute remaining width difference across character gaps
    const perCharDelta = widthDelta / (text.length - 1);

    // Only apply if the per-char adjustment is small (< 3px)
    // Large deltas indicate a fundamental font mismatch, not letter-spacing
    if (Math.abs(perCharDelta) < 3) {
      computedLetterSpacing = perCharDelta;
    }
  }

  // ── Step 4: Baseline positioning ────────────────────────────────────────

  const ascent = finalMetrics.actualBoundingBoxAscent ?? calibratedSize * 0.78;
  const descent = finalMetrics.actualBoundingBoxDescent ?? calibratedSize * 0.22;
  const textH = ascent + descent;

  // Vertically center within the bbox
  const topPad = Math.max(0, (height - textH) / 2);
  const textY = y + topPad + ascent;

  // ── Step 5: Clip and render ─────────────────────────────────────────────

  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  if (computedLetterSpacing !== 0 || (typeof letterSpacing === 'number' && letterSpacing !== 0)) {
    // Manual character-by-character rendering with letter-spacing
    const effectiveSpacing = computedLetterSpacing || letterSpacing || 0;
    let cursorX: number;

    if (alignment === 'center') {
      // Compute total width with spacing
      const totalW = renderedWidth + effectiveSpacing * (text.length - 1);
      cursorX = x + (width - totalW) / 2;
    } else if (alignment === 'right') {
      const totalW = renderedWidth + effectiveSpacing * (text.length - 1);
      cursorX = x + width - totalW;
    } else {
      cursorX = x;
    }

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      ctx.fillText(char, cursorX, textY);
      const charWidth = ctx.measureText(char).width;
      cursorX += charWidth + effectiveSpacing;
    }
  } else {
    // Standard rendering (no letter-spacing needed)
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

    ctx.fillText(text, textX, textY);
  }

  ctx.restore();
}

// ── Canvas Utilities ──────────────────────────────────────────────────────────

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
 */
export function exportCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/jpeg' = 'image/png'
): Promise<Blob> {
  const quality = mimeType === 'image/png' ? 1.0 : 0.95;

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 100) {
            if (blob.type === mimeType) {
              resolve(blob);
            } else {
              resolve(new Blob([blob], { type: mimeType }));
            }
            return;
          }

          // Fallback: toDataURL → manual base64 decode
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

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Compute median RGB from an array of [R,G,B] samples. */
function medianRGB(samples: Array<[number, number, number]>): [number, number, number] {
  if (samples.length === 0) return [128, 128, 128];
  const rs = samples.map(s => s[0]).sort((a, b) => a - b);
  const gs = samples.map(s => s[1]).sort((a, b) => a - b);
  const bs = samples.map(s => s[2]).sort((a, b) => a - b);
  const m = Math.floor(samples.length / 2);
  return [rs[m], gs[m], bs[m]];
}
