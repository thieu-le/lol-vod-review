import { createReadStream, existsSync, statSync } from 'node:fs';
import { google } from 'googleapis';
import { YOUTUBE_PRIVACY } from '@shared/types';
import { AppError } from '../../lib/errors';
import type { OAuthClient } from './auth';

export interface UploadInput {
  filePath: string;
  title: string;
  description: string;
}

export interface UploadResult {
  videoId: string;
  url: string;
}

// Uploads a local VOD as an Unlisted YouTube video. googleapis streams the file
// (resumable for large media) and reports byte progress via onProgress (0–100).
export async function uploadVideo(
  auth: OAuthClient,
  input: UploadInput,
  onProgress?: (pct: number) => void
): Promise<UploadResult> {
  if (!existsSync(input.filePath)) {
    throw new AppError('VALIDATION_ERROR', `Recording file is missing: ${input.filePath}`);
  }
  const fileSize = statSync(input.filePath).size;
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: input.title.slice(0, 100), // YouTube title hard limit
          description: input.description.slice(0, 5000),
          categoryId: '20', // Gaming
        },
        status: { privacyStatus: YOUTUBE_PRIVACY, selfDeclaredMadeForKids: false },
      },
      media: { body: createReadStream(input.filePath) },
    },
    {
      onUploadProgress: (evt: { bytesRead?: number }) => {
        if (onProgress && fileSize > 0 && typeof evt.bytesRead === 'number') {
          onProgress(Math.min(100, Math.round((evt.bytesRead / fileSize) * 100)));
        }
      },
    }
  );

  const videoId = res.data.id;
  if (!videoId) throw new AppError('UNKNOWN', 'YouTube upload returned no video id');
  return { videoId, url: `https://youtu.be/${videoId}` };
}
