import { NextRequest, NextResponse } from 'next/server';
import { RekognitionClient, DetectTextCommand } from '@aws-sdk/client-rekognition';

// Ensure the code runs dynamically, as it depends on an external API and POST body
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // seconds — allow time for large images

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return NextResponse.json(
        { error: 'imageBase64 field is required' },
        { status: 400 }
      );
    }

    // Extract the raw base64 data from the data URL format: "data:image/jpeg;base64,..."
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Initialize AWS client using environment variables
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!region || !accessKeyId || !secretAccessKey) {
      console.error('Missing AWS credentials in environment variables');
      return NextResponse.json(
        { error: 'Server misconfiguration: missing AWS credentials' },
        { status: 500 }
      );
    }

    const client = new RekognitionClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const command = new DetectTextCommand({
      Image: {
        Bytes: buffer,
      },
      Filters: {
        WordFilter: {
          MinConfidence: 50,
        }
      }
    });

    const response = await client.send(command);
    
    // We only care about words, not full lines, as our clustering logic handles grouping,
    // or we can use AWS's exact word bounding boxes to be more precise for editing.
    // AWS returns both LINE and WORD types.
    const words = response.TextDetections?.filter(d => d.Type === 'WORD').map((d) => ({
      text: d.DetectedText,
      confidence: d.Confidence,
      bbox_percent: d.Geometry?.BoundingBox, // Left, Top, Width, Height are all 0-1 percentages
    })) || [];

    return NextResponse.json({ words });
  } catch (error: any) {
    console.error('Error during OCR processing:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error during OCR' },
      { status: 500 }
    );
  }
}
