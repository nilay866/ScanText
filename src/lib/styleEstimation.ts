// Style estimation engine — extracts font properties from screenshot pixels
import { RawWord } from './types';

/**
 * Estimate font size from bounding box height.
 * We want the logical font size to closely match the visual height of the text region exactly.
 * Bounding boxes are already tightly fitted by OCR/AWS.
 */
export function estimateFontSize(bboxHeight: number): number {
  return Math.max(8, bboxHeight);
}

/**
 * Estimate font weight by analyzing stroke thickness.
 * Bold text has thicker strokes relative to character height.
 */
export function estimateFontWeight(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  bgColor: { r: number; g: number; b: number }
): string {
  if (width <= 0 || height <= 0) return '400';

  const imgWidth = imageData.width;
  const data = imageData.data;
  let darkPixels = 0;
  let totalPixels = 0;

  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const ex = Math.min(imgWidth, Math.floor(x + width));
  const ey = Math.min(imageData.height, Math.floor(y + height));

  for (let py = sy; py < ey; py += 2) {
    for (let px = sx; px < ex; px += 2) {
      const idx = (py * imgWidth + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const diff = Math.abs(r - bgColor.r) + Math.abs(g - bgColor.g) + Math.abs(b - bgColor.b);
      if (diff > 80) darkPixels++;
      totalPixels++;
    }
  }

  const ratio = totalPixels > 0 ? darkPixels / totalPixels : 0;
  return ratio > 0.38 ? '700' : '400';
}

/**
 * Sample the dominant text color from the center of each character.
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

  const colors: Array<{ r: number; g: number; b: number }> = [];

  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const ex = Math.min(imgWidth, Math.floor(x + width));
  const ey = Math.min(imageData.height, Math.floor(y + height));

  // Sample center rows
  const centerY = Math.floor((sy + ey) / 2);
  for (let py = centerY - 2; py <= centerY + 2; py++) {
    if (py < sy || py >= ey) continue;
    for (let px = sx; px < ex; px += 2) {
      const idx = (py * imgWidth + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const diff = Math.abs(r - bgColor.r) + Math.abs(g - bgColor.g) + Math.abs(b - bgColor.b);
      if (diff > 60) {
        colors.push({ r, g, b });
      }
    }
  }

  if (colors.length === 0) {
    return '#000000';
  }

  // Take the median color
  colors.sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b));
  const median = colors[Math.floor(colors.length / 2)];
  return rgbToHex(median.r, median.g, median.b);
}

/**
 * Sample the background color around a text bounding box.
 * Uses the border pixels (2px strip) and takes the median.
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

  const pad = 3;
  const sx = Math.max(0, Math.floor(x) - pad);
  const sy = Math.max(0, Math.floor(y) - pad);
  const ex = Math.min(imgWidth, Math.ceil(x + width) + pad);
  const ey = Math.min(imgHeight, Math.ceil(y + height) + pad);

  // Top edge
  for (let px = sx; px < ex; px++) {
    for (let py = sy; py < Math.min(sy + pad, ey); py++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  // Bottom edge
  for (let px = sx; px < ex; px++) {
    for (let py = Math.max(ey - pad, sy); py < ey; py++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  // Left edge
  for (let py = sy; py < ey; py++) {
    for (let px = sx; px < Math.min(sx + pad, ex); px++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }
  // Right edge
  for (let py = sy; py < ey; py++) {
    for (let px = Math.max(ex - pad, sx); px < ex; px++) {
      const idx = (py * imgWidth + px) * 4;
      colors.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
    }
  }

  if (colors.length === 0) {
    return { r: 255, g: 255, b: 255, hex: '#ffffff' };
  }

  // Median of each channel (robust to text pixel contamination)
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
 * Estimate text alignment based on position relative to detected line.
 */
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

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
