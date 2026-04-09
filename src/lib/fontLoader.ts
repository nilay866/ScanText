/**
 * Font Loader — Platform detection & dynamic font loading for pixel-perfect rendering.
 *
 * Strategy:
 *  1. Analyse the screenshot image pixels for platform-specific UI cues
 *  2. Map detected platform → exact font family
 *  3. Load the font from Google Fonts via the FontFace API (no stylesheet injection)
 *  4. Track readiness so renderText() never fires before the font is usable
 */

import { DetectedPlatform } from './types';

// ── Platform → Font mapping ───────────────────────────────────────────────────

interface PlatformFontConfig {
  /** Primary CSS font-family value (must be quoted if multi-word) */
  primary: string;
  /** Full font stack for the CSS font shorthand */
  stack: string;
  /** Google Fonts family name (null = use system font, no download needed) */
  googleFontFamily: string | null;
  /** Weights to preload */
  weights: number[];
}

const PLATFORM_FONTS: Record<DetectedPlatform, PlatformFontConfig> = {
  ios: {
    primary: 'system-ui',
    stack: 'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif',
    googleFontFamily: null, // SF Pro is available as system-ui on Apple devices; on non-Apple we use the closest fallback
    weights: [300, 400, 500, 600, 700],
  },
  android: {
    primary: 'Roboto',
    stack: '"Roboto", "Noto Sans", "Droid Sans", Arial, sans-serif',
    googleFontFamily: 'Roboto',
    weights: [300, 400, 500, 700],
  },
  windows: {
    primary: 'Segoe UI',
    stack: '"Segoe UI", "Segoe UI Variable", Tahoma, Verdana, Arial, sans-serif',
    googleFontFamily: null, // Segoe UI is a Windows system font
    weights: [300, 400, 600, 700],
  },
  web: {
    primary: 'Inter',
    stack: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
    googleFontFamily: 'Inter',
    weights: [300, 400, 500, 600, 700],
  },
  unknown: {
    primary: 'Inter',
    stack: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    googleFontFamily: 'Inter',
    weights: [300, 400, 500, 600, 700],
  },
};

// ── Font loading state ────────────────────────────────────────────────────────

const loadedFonts = new Set<string>();
let currentPlatformConfig: PlatformFontConfig = PLATFORM_FONTS.unknown;

/**
 * Get the font stack string for the currently detected platform.
 */
export function getFontStack(): string {
  return currentPlatformConfig.stack;
}

/**
 * Get the primary font family name for the current platform.
 */
export function getPrimaryFont(): string {
  return currentPlatformConfig.primary;
}

/**
 * Detect the platform from the screenshot image and load the appropriate font.
 * Call this once after OCR completes.
 *
 * Detection heuristics (applied to the image):
 *  - iOS: rounded status bar icons, specific notch/dynamic island shape at top
 *  - Android: status bar icons style (left-aligned clock, right-aligned battery)
 *  - Windows: taskbar pattern at bottom, window chrome
 *  - Web: no strong mobile signals → defaults to web/Inter
 */
export async function detectAndLoadFont(
  image: HTMLImageElement,
  imageData: ImageData
): Promise<DetectedPlatform> {
  const platform = detectPlatform(image, imageData);
  const config = PLATFORM_FONTS[platform];
  currentPlatformConfig = config;

  if (config.googleFontFamily && !loadedFonts.has(config.googleFontFamily)) {
    await loadGoogleFont(config.googleFontFamily, config.weights);
    loadedFonts.add(config.googleFontFamily);
  }

  return platform;
}

/**
 * Force-load a specific platform font (useful if auto-detection is wrong).
 */
export async function loadFontForPlatform(platform: DetectedPlatform): Promise<void> {
  const config = PLATFORM_FONTS[platform];
  currentPlatformConfig = config;

  if (config.googleFontFamily && !loadedFonts.has(config.googleFontFamily)) {
    await loadGoogleFont(config.googleFontFamily, config.weights);
    loadedFonts.add(config.googleFontFamily);
  }
}

// ── Platform detection ────────────────────────────────────────────────────────

function detectPlatform(image: HTMLImageElement, imageData: ImageData): DetectedPlatform {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const ratio = h / w;

  // Mobile screenshots are tall (ratio > 1.5 typically)
  const isMobileAspect = ratio > 1.5;

  if (!isMobileAspect) {
    // Could be desktop or landscape — check for Windows taskbar or web browser chrome
    if (hasWindowsTaskbar(imageData, w, h)) return 'windows';
    return 'web';
  }

  // Mobile screenshot — distinguish iOS vs Android

  // Check common iOS screen widths (1x: 375,390,393,414,428,430  2x/3x: 750,828,1125,1170,1179,1242,1284,1290)
  const iosWidths = [375, 390, 393, 414, 428, 430, 750, 828, 1125, 1170, 1179, 1242, 1284, 1290];
  const androidWidths = [360, 384, 392, 393, 411, 412, 720, 768, 1080, 1440];

  const isLikelyIosWidth = iosWidths.some(iw => Math.abs(w - iw) < 5);
  const isLikelyAndroidWidth = androidWidths.some(aw => Math.abs(w - aw) < 5);

  // Analyse the status bar area (top 4% of image)
  const statusBarInfo = analyseStatusBar(imageData, w, h);

  // iOS heuristics:
  //  - Notch/dynamic island: dark region centered at top
  //  - Time centered, signal bars on left, battery on right
  //  - Status bar height: ~44-54px on retina
  if (statusBarInfo.hasCenteredNotch || statusBarInfo.hasDynamicIsland) {
    return 'ios';
  }

  if (isLikelyIosWidth && !isLikelyAndroidWidth) return 'ios';
  if (isLikelyAndroidWidth && !isLikelyIosWidth) return 'android';

  // Fallback: check status bar icon patterns
  if (statusBarInfo.hasLeftClock) return 'android';
  if (statusBarInfo.hasCenteredTime) return 'ios';

  // Can't determine — return android for mobile (more prevalent)
  return isMobileAspect ? 'android' : 'web';
}

function analyseStatusBar(
  imageData: ImageData,
  w: number,
  h: number
): {
  hasCenteredNotch: boolean;
  hasDynamicIsland: boolean;
  hasLeftClock: boolean;
  hasCenteredTime: boolean;
} {
  const data = imageData.data;
  const statusBarHeight = Math.min(Math.floor(h * 0.04), 60);

  // Check for dark notch region centered at the very top
  let darkCenterPixels = 0;
  let totalCenterPixels = 0;
  const centerStart = Math.floor(w * 0.3);
  const centerEnd = Math.floor(w * 0.7);

  for (let y = 0; y < Math.min(statusBarHeight, 20); y++) {
    for (let x = centerStart; x < centerEnd; x += 2) {
      const idx = (y * w + x) * 4;
      const brightness = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (brightness < 30) darkCenterPixels++;
      totalCenterPixels++;
    }
  }

  const darkCenterRatio = totalCenterPixels > 0 ? darkCenterPixels / totalCenterPixels : 0;
  const hasCenteredNotch = darkCenterRatio > 0.6;

  // Dynamic island: small dark pill shape in top-center (narrower than notch)
  let pillPixels = 0;
  let pillTotal = 0;
  const pillStart = Math.floor(w * 0.35);
  const pillEnd = Math.floor(w * 0.65);

  for (let y = 5; y < Math.min(20, statusBarHeight); y++) {
    for (let x = pillStart; x < pillEnd; x += 2) {
      const idx = (y * w + x) * 4;
      const brightness = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (brightness < 25) pillPixels++;
      pillTotal++;
    }
  }

  const hasDynamicIsland = pillTotal > 0 && (pillPixels / pillTotal) > 0.3 && (pillPixels / pillTotal) < 0.7;

  // Check for elements in left quarter of status bar (Android puts clock there)
  let leftActivityPixels = 0;
  let leftTotal = 0;
  const leftEnd = Math.floor(w * 0.25);

  // Sample the status bar content area (skip very top edge)
  const contentStart = Math.min(5, statusBarHeight);
  for (let y = contentStart; y < statusBarHeight; y++) {
    for (let x = 5; x < leftEnd; x += 2) {
      const idx = (y * w + x) * 4;
      // Get background reference from corners
      const bgIdx = (contentStart * w + 3) * 4;
      const bgBrightness = data[bgIdx] * 0.299 + data[bgIdx + 1] * 0.587 + data[bgIdx + 2] * 0.114;
      const pxBrightness = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (Math.abs(pxBrightness - bgBrightness) > 40) leftActivityPixels++;
      leftTotal++;
    }
  }

  const hasLeftClock = leftTotal > 0 && (leftActivityPixels / leftTotal) > 0.05;

  // Center time indicator (iOS)
  let centerActivityPixels = 0;
  let centerTotal = 0;
  const timeStart = Math.floor(w * 0.4);
  const timeEnd = Math.floor(w * 0.6);

  for (let y = contentStart; y < statusBarHeight; y++) {
    for (let x = timeStart; x < timeEnd; x += 2) {
      const idx = (y * w + x) * 4;
      const bgIdx = (contentStart * w + 3) * 4;
      const bgBrightness = data[bgIdx] * 0.299 + data[bgIdx + 1] * 0.587 + data[bgIdx + 2] * 0.114;
      const pxBrightness = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      if (Math.abs(pxBrightness - bgBrightness) > 40) centerActivityPixels++;
      centerTotal++;
    }
  }

  const hasCenteredTime = centerTotal > 0 && (centerActivityPixels / centerTotal) > 0.04 && !hasLeftClock;

  return { hasCenteredNotch, hasDynamicIsland, hasLeftClock, hasCenteredTime };
}

function hasWindowsTaskbar(imageData: ImageData, w: number, h: number): boolean {
  // Windows taskbar: uniform strip at the very bottom (~40-48px)
  const data = imageData.data;
  const barHeight = 48;
  const barStart = h - barHeight;

  if (barStart < 0) return false;

  // Sample the taskbar area — it should be fairly uniform in color
  let firstR = 0, firstG = 0, firstB = 0;
  let uniformCount = 0;
  let totalSamples = 0;

  for (let y = barStart; y < h; y += 4) {
    for (let x = 0; x < w; x += 20) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      if (totalSamples === 0) {
        firstR = r; firstG = g; firstB = b;
      }

      const diff = Math.abs(r - firstR) + Math.abs(g - firstG) + Math.abs(b - firstB);
      if (diff < 30) uniformCount++;
      totalSamples++;
    }
  }

  // Taskbar is uniform if >80% of pixels match the first pixel's color
  return totalSamples > 0 && (uniformCount / totalSamples) > 0.8;
}

// ── Google Fonts loading via FontFace API ─────────────────────────────────────

async function loadGoogleFont(family: string, weights: number[]): Promise<void> {
  const weightStr = weights.join(';');
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weightStr}&display=swap`;

  try {
    // Fetch the CSS to get the actual font file URLs
    const cssResponse = await fetch(url);
    if (!cssResponse.ok) {
      console.warn(`[FontLoader] Failed to fetch font CSS for ${family}`);
      return;
    }

    const cssText = await cssResponse.text();

    // Parse @font-face blocks from the CSS
    const fontFaceRegex = /@font-face\s*\{([^}]+)\}/g;
    const srcRegex = /src:\s*url\(([^)]+)\)/;
    const weightRegex = /font-weight:\s*(\d+)/;

    let match;
    const loadPromises: Promise<void>[] = [];

    while ((match = fontFaceRegex.exec(cssText)) !== null) {
      const block = match[1];
      const srcMatch = srcRegex.exec(block);
      const weightMatch = weightRegex.exec(block);

      if (srcMatch) {
        const fontUrl = srcMatch[1];
        const fontWeight = weightMatch ? weightMatch[1] : '400';

        const fontFace = new FontFace(family, `url(${fontUrl})`, {
          weight: fontWeight,
          style: 'normal',
          display: 'swap',
        });

        loadPromises.push(
          fontFace.load().then((loadedFace) => {
            document.fonts.add(loadedFace);
          }).catch((err) => {
            console.warn(`[FontLoader] Failed to load ${family} weight ${fontWeight}:`, err);
          })
        );
      }
    }

    await Promise.all(loadPromises);

    // Wait for all fonts to be fully ready
    await document.fonts.ready;

    console.log(`[FontLoader] Loaded ${family} (${loadPromises.length} variants)`);
  } catch (err) {
    console.warn(`[FontLoader] Error loading ${family}:`, err);
  }
}
