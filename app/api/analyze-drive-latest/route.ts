import {NextResponse} from 'next/server';
import {z} from 'zod';

import {getLatestMediaFromDrive} from '@/lib/server/drive';
import {analyzeMediaWithGemini} from '@/lib/server/gemini';
import type {AnalysisResponse, ApiErrorResponse} from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const requestSchema = z.object({
  folderName: z.string().min(1).max(200).optional(),
  parentFolderId: z.string().min(5).max(200).optional(),
  folderIdOverride: z.string().min(5).max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = requestSchema.parse(raw);

    const latest = await getLatestMediaFromDrive({
      folderName: parsed.folderName,
      parentFolderId: parsed.parentFolderId,
      folderIdOverride: parsed.folderIdOverride,
    });

    const report = await analyzeMediaWithGemini({
      fileBuffer: latest.data,
      mimeType: latest.mimeType,
      sourceName: latest.source.name,
    });

    const payload: AnalysisResponse = {
      report,
      source: latest.source,
    };

    return NextResponse.json(payload, {status: 200});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiErrorResponse>(
        {
          error: {
            message: 'Invalid request payload.',
            details: error.errors.map((entry) => entry.message).join(' '),
          },
        },
        {status: 400},
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const status = message.toLowerCase().includes('no supported recording') ? 404 : 500;

    return NextResponse.json<ApiErrorResponse>(
      {
        error: {
          message: 'Failed to analyze latest Drive recording.',
          details: message,
        },
      },
      {status},
    );
  }
}
