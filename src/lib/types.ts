// TypeScript interfaces for ScanText

export type DetectedPlatform = 'ios' | 'android' | 'windows' | 'web' | 'unknown';

export interface WordBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
}

export interface TextRegion {
  id: string;
  text: string;
  editedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  letterSpacing?: number;
  color: string;
  alignment: 'left' | 'center' | 'right';
  confidence: number;
  lineIndex: number;
  backgroundColor: string;
  isEditing: boolean;
  isSelected: boolean;

  // --- Pixel-perfect rendering fields ---
  /** Per-word bounding boxes from OCR for precise positioning */
  wordBboxes?: WordBbox[];
  /** Detected screenshot platform for font matching */
  detectedPlatform?: DetectedPlatform;
  /** Font size after binary-search calibration (may differ from initial estimate) */
  calibratedFontSize?: number;
  /** Letter spacing after width-matching calibration */
  calibratedLetterSpacing?: number;
  /** Continuous font weight 100-900 (more granular than just 400/700) */
  fontWeightNumeric?: number;
}

export interface EditorState {
  image: HTMLImageElement | null;
  imageData: string | null;
  regions: TextRegion[];
  selectedRegionId: string | null;
  scale: number;
  position: { x: number; y: number };
  isProcessing: boolean;
  processingProgress: number;
  processingStatus: string;
}

export interface OCRResult {
  regions: TextRegion[];
  rawWords: RawWord[];
}

export interface RawWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}
