// OCR pipeline — AWS Rekognition wrapper for text detection
import { RawWord, TextRegion } from './types';
import { detectTextRegions } from './textDetection';
import { imageToCanvas, getImageData } from './inpainting';

export interface OCRProgress {
  status: string;
  progress: number;
}

/**
 * Run the complete OCR pipeline on an image:
 * 1. Convert image to optimized Base64
 * 2. Ping secure backend proxy to query AWS Rekognition
 * 3. Convert AWS percent coordinates to physical pixels
 * 4. Post-process into styled TextRegions
 */
export async function runOCR(
  image: HTMLImageElement,
  onProgress?: (p: OCRProgress) => void
): Promise<TextRegion[]> {
  onProgress?.({ status: 'Preparing screenshot...', progress: 0.1 });

  const canvas = imageToCanvas(image);
  // Compress to jpeg to save bandwidth/API payload limits
  const dataPathUrl = canvas.toDataURL('image/jpeg', 0.8); 

  onProgress?.({ status: 'Uploading to AWS Rekognition...', progress: 0.3 });

  // Send to Next.js API boundary 
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: dataPathUrl })
  });

  if (!res.ok) {
     const errorBody = await res.json();
     throw new Error(errorBody.error || 'Failed to detect text');
  }

  onProgress?.({ status: 'Analyzing layout...', progress: 0.7 });

  const data = await res.json();
  const awsWords = data.words || [];

  // Extract raw words with bounded pixel box calculations
  const rawWords: RawWord[] = [];
  
  for (const w of awsWords) {
    if (!w.bbox_percent) continue;
    
    // AWS returns coordinates normalized 0.0-1.0
    const width = w.bbox_percent.Width * image.naturalWidth;
    const height = w.bbox_percent.Height * image.naturalHeight;
    const left = w.bbox_percent.Left * image.naturalWidth;
    const top = w.bbox_percent.Top * image.naturalHeight;

    rawWords.push({
      text: w.text,
      confidence: w.confidence,
      bbox: {
        x0: left,
        y0: top,
        x1: left + width,
        y1: top + height,
      },
    });
  }

  onProgress?.({ status: 'Detecting text styles...', progress: 0.85 });

  // Get image data for style estimation
  const imgData = getImageData(canvas);

  // Build styled text regions using the previously mapped coordinates
  const regions = detectTextRegions(rawWords, imgData);

  onProgress?.({ status: 'Finalizing...', progress: 1.0 });

  return regions;
}
