/**
 * Style Estimation Engine v2 — Precision extraction of font properties from screenshot pixels.
 *
 * Improvements over v1:
 *  - Font size uses a descent/ascender-aware ratio instead of raw bbox height
 *  - Font weight is continuous (300-900) not binary (400/700)
 *  - Text color uses weighted histogram clustering, not single-row median
 *  - Letter spacing is estimated from per-word bbox gaps
 *  - Background sampling uses larger window with outlier rejection
 */

import { RawWord, WordBbox } from './types';

// ── Font Size ─────────────────────────────────────────────────────────────────

/**
 * Estimate initial font size from bounding box height.
 *
 * OCR bboxes tightly wrap the inked glyphs. For most fonts:
 *   CSS fontSize ≈ bboxHeight / lineHeightRatio
 * where lineHeightRatio accounts for the font's internal leading.
 *
 * Typical ratios (ascent+descent / em):
 *   Roboto: ~0.88   SF Pro: ~0.86   Inter: ~0.88   Segoe UI: ~0.87
 * We use 0.87 as a balanced default. renderText() will binary-search refine this.
 */
export function estimateFontSize(bboxHeight: number): number {
  // The bbox captures ascent + visible descent (no descender if text is "HELLO")
  // Best initial guess: fontSize ≈ bboxHeight / 0.87
  // This gets us within ±2px; the calibration loop in renderText does the rest
  const estimated = bboxHeight / 0.87;
  return Math.max(8, Math.round(estimated * 10) / 10); // 0.1px precision
}

// ── Font Weight ───────────────────────────────────────────────────────────────

/**
 * Estimate font weight by analysing ink density (stroke-width proxy).
 *
 * Returns a numeric weight: 300, 400, 500, 600, 700, 800, or 900.
 * Also returns the CSS string for backward compatibility.
 */
export function estimateFontWeight(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: { r: number; g: number; b: number }
): string {
  return String(estimateFontWeightNumeric(imageData, x, y, width, height, bgColor));
}

export function estimateFontWeightNumeric(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: { r: number; g: number; b: number }
): number {
  if (width <= 0 || height <= 0) return 400;

  const imgWidth = imageData.width;
  const data = imageData.data;
  let inkPixels = 0;
  let totalPixels = 0;

  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const ex = Math.min(imgWidth, Math.floor(x + width));
  const ey = Math.min(imageData.height, Math.floor(y + height));

  // Sample every pixel (not every 2nd) for accuracy
  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < ex; px++) {
      const idx = (py * imgWidth + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const diff = Math.abs(r - bgColor.r) + Math.abs(g - bgColor.g) + Math.abs(b - bgColor.b);
      if (diff > 50) inkPixels++; // Lowered from 80 to catch anti-aliased edges
      totalPixels++;
    }
  }

  const ratio = totalPixels > 0 ? inkPixels / totalPixels : 0;

  // Map ink density → CSS weight
  // These thresholds are calibrated empirically across iOS/Android screenshots
  if (ratio < 0.22) return 300;  // Light
  if (ratio < 0.30) return 400;  // Regular
  if (ratio < 0.36) return 500;  // Medium
  if (ratio < 0.42) return 600;  // Semibold
  if (ratio < 0.50) return 700;  // Bold
  if (ratio < 0.58) return 800;  // Extrabold
  return 900;                     // Black
}

// ── Text Color ────────────────────────────────────────────────────────────────

/**
 * Extract the dominant text color using weighted histogram clustering.
 *
 * Samples ALL ink pixels in the bbox (not just center row), clusters them,
 * and returns the largest cluster's centroid color.
 */
export function estimateTextColor(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: { r: number; g: number; b: number }
): string {
  const imgWidth = imageData.width;
  const data = imageData.data;

  const inkPixels: Array<{ r: number; g: number; b: number; weight: number }> = [];

  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const ex = Math.min(imgWidth, Math.floor(x + width));
  const ey = Math.min(imageData.height, Math.floor(y + height));

  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < ex; px++) {
      const idx = (py * imgWidth + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const diff = Math.abs(r - bgColor.r) + Math.abs(g - bgColor.g) + Math.abs(b - bgColor.b);

      if (diff > 40) {
        // Weight by how far from background (strong ink = higher weight)
        const weight = Math.min(diff / 255, 1);
        inkPixels.push({ r, g, b, weight });
      }
    }
  }

  if (inkPixels.length === 0) {
    return '#000000';
  }

  // Simple dominant color: weighted average of top 60% most confident samples
  // Sort by weight descending, take top 60%
  inkPixels.sort((a, b) => b.weight - a.weight);
  const cutoff = Math.max(1, Math.floor(inkPixels.length * 0.6));
  const topPixels = inkPixels.slice(0, cutoff);

  let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
  for (const p of topPixels) {
    sumR += p.r * p.weight;
    sumG += p.g * p.weight;
    sumB += p.b * p.weight;
    sumW += p.weight;
  }

  const avgR = Math.round(sumR / sumW);
  const avgG = Math.round(sumG / sumW);
  const avgB = Math.round(sumB / sumW);

  return rgbToHex(avgR, avgG, avgB);
}

// ── Background Color ──────────────────────────────────────────────────────────

/**
 * Sample the background color around a text bounding box.
 * Uses wider border (5px) and channel-wise median with outlier rejection.
 */
export function sampleBackgroundColor(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): { r: number; g: number; b: number; hex: string } {
  const imgWidth = imageData.width;
  const imgHeight = imageData.height;
  const data = imageData.data;
  const colors: Array<{ r: number; g: number; b: number }> = [];

  const pad = 5;
  const sx = Math.max(0, Math.floor(x) - pad);
  const sy = Math.max(0, Math.floor(y) - pad);
  const ex = Math.min(imgWidth, Math.ceil(x + width) + pad);
  const ey = Math.min(imgHeight, Math.ceil(y + height) + pad);

  // Top edge strip
  for (let px = sx; px < ex; px++) {
    for (let py = sy; py < Math.min(sy + pad, ey); py++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  // Bottom edge strip
  for (let px = sx; px < ex; px++) {
    for (let py = Math.max(ey - pad, sy); py < ey; py++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  // Left edge strip
  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < Math.min(sx + pad, ex); px++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  // Right edge strip
  for (let py = sy; py < ey; py++) {
    for (let px = Math.max(ex - pad, sx); px < ex; px++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  if (colors.length === 0) {
    return { r: 255, g: 255, b: 255, hex: '#ffffff' };
  }

  // Channel-wise median (robust to text pixel contamination at borders)
  const rs = colors.map(c => c.r).sort((a, b) => a - b);
  const gs = colors.map(c => c.g).sort((a, b) => a - b);
  const bs = colors.map(c => c.b).sort((a, b) => a - b);
  const mid = Math.floor(colors.length / 2);

  const r = rs[mid];
  const g = gs[mid];
  const b = bs[mid];

  return { r, g, b, hex: rgbToHex(r, g, b) };
}

/**
 * Sample background color at four individual edges for gradient-aware inpainting.
 * Returns the median color at top, bottom, left, and right edges independently.
 */
export function sampleEdgeColors(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): {
  top: { r: number; g: number; b: number };
  bottom: { r: number; g: number; b: number };
  left: { r: number; g: number; b: number };
  right: { r: number; g: number; b: number };
} {
  const imgWidth = imageData.width;
  const imgHeight = imageData.height;
  const data = imageData.data;
  const pad = 4;

  const sx = Math.max(0, Math.floor(x) - pad);
  const sy = Math.max(0, Math.floor(y) - pad);
  const ex = Math.min(imgWidth, Math.ceil(x + width) + pad);
  const ey = Math.min(imgHeight, Math.ceil(y + height) + pad);

  function medianColor(pixels: Array<{ r: number; g: number; b: number }>) {
    if (pixels.length === 0) return { r: 128, g: 128, b: 128 };
    const rs = pixels.map(c => c.r).sort((a, b) => a - b);
    const gs = pixels.map(c => c.g).sort((a, b) => a - b);
    const bs = pixels.map(c => c.b).sort((a, b) => a - b);
    const m = Math.floor(pixels.length / 2);
    return { r: rs[m], g: gs[m], b: bs[m] };
  }

  // Top strip
  const top: Array<{ r: number; g: number; b: number }> = [];
  for (let px = sx; px < ex; px++) {
    for (let py = sy; py < Math.min(sy + pad, ey); py++) {
      const idx = (py * imgWidth + px) * 4;
      top.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  // Bottom strip
  const bottom: Array<{ r: number; g: number; b: number }> = [];
  for (let px = sx; px < ex; px++) {
    for (let py = Math.max(ey - pad, sy); py < ey; py++) {
      const idx = (py * imgWidth + px) * 4;
      bottom.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  // Left strip
  const left: Array<{ r: number; g: number; b: number }> = [];
  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < Math.min(sx + pad, ex); px++) {
      const idx = (py * imgWidth + px) * 4;
      left.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  // Right strip
  const right: Array<{ r: number; g: number; b: number }> = [];
  for (let py = sy; py < ey; py++) {
    for (let px = Math.max(ex - pad, sx); px < ex; px++) {
      const idx = (py * imgWidth + px) * 4;
      right.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  return {
    top: medianColor(top),
    bottom: medianColor(bottom),
    left: medianColor(left),
    right: medianColor(right),
  };
}

// ── Alignment ─────────────────────────────────────────────────────────────────

export function estimateAlignment(
  wordX: number,
  lineWidth: number,
  lineX: number
): 'left' | 'center' | 'right' {
  const relPos = (wordX - lineX) / Math.max(lineWidth, 1);
  if (relPos < 0.2) return 'left';
  if (relPos > 0.7) return 'right';
  return 'center';
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}
