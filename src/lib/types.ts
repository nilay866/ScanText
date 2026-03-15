// TypeScript interfaces for ScanText
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
