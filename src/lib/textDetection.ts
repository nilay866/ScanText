// Text detection pipeline — bounding box extraction, line grouping, filtering
import { v4 as uuidv4 } from 'uuid';
import { TextRegion, RawWord } from './types';
import {
  estimateFontSize,
  estimateFontWeight,
  estimateTextColor,
  sampleBackgroundColor,
} from './styleEstimation';

/**
 * Group raw OCR words into line-based text regions.
 * Words on the same Y-coordinate line AND within horizontal proximity are grouped together.
 */
export function groupWordsIntoLines(words: RawWord[]): RawWord[][] {
  if (words.length === 0) return [];

  // Sort by Y position, then X
  const sorted = [...words].sort((a, b) => {
    const yDiff = a.bbox.y0 - b.bbox.y0;
    // Words within 5px vertically are considered on the same "level"
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.bbox.x0 - b.bbox.x0;
  });

  const lines: RawWord[][] = [];
  let currentLine: RawWord[] = [sorted[0]];
  
  let currentY = sorted[0].bbox.y0;
  let currentHeight = sorted[0].bbox.y1 - sorted[0].bbox.y0;
  let lastX = sorted[0].bbox.x1;

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    const wordHeight = word.bbox.y1 - word.bbox.y0;
    
    // Vertical overlap check
    const yOverlap = Math.min(currentY + currentHeight, word.bbox.y0 + wordHeight) - Math.max(currentY, word.bbox.y0);
    const overlapRatio = yOverlap / Math.min(currentHeight, wordHeight);
    
    // Horizontal distance check (max gap allowed between words in same region)
    const xGap = word.bbox.x0 - lastX;
    
    // If words overlap vertically > 40% AND are relatively close horizontally (< 1.5x word height gap)
    if (overlapRatio > 0.4 && xGap < Math.max(currentHeight, wordHeight) * 1.5) {
      currentLine.push(word);
      lastX = word.bbox.x1;
      // Adjust current line Y bounding box
      currentY = Math.min(currentY, word.bbox.y0);
      currentHeight = Math.max(currentY + currentHeight, word.bbox.y1) - currentY;
    } else {
      // New line or completely separate horizontal block
      lines.push(currentLine);
      currentLine = [word];
      currentY = word.bbox.y0;
      currentHeight = wordHeight;
      lastX = word.bbox.x1;
    }
  }
  lines.push(currentLine);

  return lines;
}

/**
 * Merge words in a line into a single text region.
 */
function mergeLineWords(words: RawWord[]): {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  avgConfidence: number;
} {
  const text = words.map(w => w.text).join(' ');
  const x = Math.min(...words.map(w => w.bbox.x0));
  const y = Math.min(...words.map(w => w.bbox.y0));
  const x1 = Math.max(...words.map(w => w.bbox.x1));
  const y1 = Math.max(...words.map(w => w.bbox.y1));
  const avgConfidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;

  return {
    text,
    x,
    y,
    width: x1 - x,
    height: y1 - y,
    avgConfidence,
  };
}

/**
 * Filter out noise: low-confidence detections and tiny boxes.
 */
export function filterWords(words: RawWord[], minConfidence = 50, minArea = 25): RawWord[] {
  return words.filter(w => {
    if (w.confidence < minConfidence) return false;
    const area = (w.bbox.x1 - w.bbox.x0) * (w.bbox.y1 - w.bbox.y0);
    if (area < minArea) return false;
    if (w.text.trim().length === 0) return false;
    return true;
  });
}

/**
 * Build TextRegion objects from grouped lines with style estimation.
 */
export function buildTextRegions(
  lines: RawWord[][],
  imageData: ImageData
): TextRegion[] {
  const regions: TextRegion[] = [];

  lines.forEach((lineWords, lineIndex) => {
    const merged = mergeLineWords(lineWords);
    const bgColor = sampleBackgroundColor(imageData, merged.x, merged.y, merged.width, merged.height);
    const fontSize = estimateFontSize(merged.height);
    const fontWeight = estimateFontWeight(imageData, merged.x, merged.y, merged.width, merged.height, bgColor);
    const color = estimateTextColor(imageData, merged.x, merged.y, merged.width, merged.height, bgColor);

    // Filter out falsely detected empty noise
    if (merged.text.trim().length === 0) return;

    regions.push({
      id: uuidv4(),
      text: merged.text,
      editedText: merged.text,
      x: merged.x,
      y: merged.y,
      width: merged.width,
      height: merged.height,
      fontSize,
      fontWeight,
      fontFamily: 'Inter',
      color,
      alignment: 'left',
      confidence: merged.avgConfidence,
      lineIndex,
      backgroundColor: bgColor.hex,
      isEditing: false,
      isSelected: false,
    });
  });

  return regions;
}

/**
 * Full text detection pipeline: filter → group → style → regions.
 */
export function detectTextRegions(words: RawWord[], imageData: ImageData): TextRegion[] {
  const filtered = filterWords(words);
  const lines = groupWordsIntoLines(filtered);
  return buildTextRegions(lines, imageData);
}
