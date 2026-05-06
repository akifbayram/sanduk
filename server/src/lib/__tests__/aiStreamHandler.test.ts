import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../aiImageResize.js', () => ({
  resizeImageForAi: vi.fn(async () => ({
    buffer: Buffer.from('RESIZED'),
    mimeType: 'image/webp',
  })),
}));

vi.mock('../aiStream.js', () => ({
  pipeAiStreamToResponse: vi.fn(async () => {}),
  withClientDisconnect: vi.fn((_req: unknown, base?: AbortSignal) => base ?? new AbortController().signal),
}));

vi.mock('../aiSettings.js', () => ({
  getUserAiSettings: vi.fn(async () => ({
    config: { provider: 'openai', apiKey: 'k', model: 'm', endpointUrl: null },
    custom_prompt: null,
    max_tokens: 4096,
    temperature: 0.3,
    top_p: undefined,
    request_timeout: 300,
  })),
  getConfigForTask: vi.fn(() => ({ provider: 'openai', apiKey: 'k', model: 'm', endpointUrl: null })),
}));

vi.mock('../taskRouting.js', () => ({
  resolveTaskConfig: vi.fn(async () => ({ provider: 'openai', apiKey: 'k', model: 'm', endpointUrl: null })),
  TASK_GROUP_MAP: { analysis: 'vision' },
}));

vi.mock('../sdkProviderFactory.js', () => ({
  createSdkModel: vi.fn(() => ({})),
}));

vi.mock('../aiSsrf.js', () => ({
  resolvePinnedFetch: vi.fn(async () => undefined),
}));

vi.mock('../binAccess.js', () => ({
  verifyOptionalLocationMembership: vi.fn(async () => true),
}));

vi.mock('../aiProviders.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system'),
  buildAnalysisUserText: vi.fn(() => 'text'),
  IMAGE_TOKENS_SINGLE: 10000,
  IMAGE_TOKENS_MULTI: 10000,
}));

vi.mock('../config.js', () => ({
  isDemoUser: vi.fn(() => false),
}));

vi.mock('../aiSchemas.js', () => ({
  AiSuggestionsSchema: {},
}));

import { resizeImageForAi } from '../aiImageResize.js';
import { runAnalysisStream } from '../aiStreamHandler.js';

describe('runAnalysisStream', () => {
  it('calls resizeImageForAi and uses the resized buffer for image parts', async () => {
    const originalBuffer = Buffer.from('ORIGINAL');
    const capturedImageParts: Array<{ image: Buffer; mimeType: string }> = [];

    const buildUserContent = vi.fn((args: { imageParts: Array<{ type: 'image'; image: Buffer; mimeType: string }>; imageCount: number }) => {
      for (const part of args.imageParts) {
        capturedImageParts.push({ image: part.image, mimeType: part.mimeType });
      }
      return 'mock-content' as unknown as import('ai').UserContent;
    });

    const mockReq = { user: { id: 'user-1' }, once: vi.fn().mockReturnThis() } as unknown as Request;
    const mockRes = {} as Response;

    await runAnalysisStream({
      req: mockReq,
      res: mockRes,
      images: [{ buffer: originalBuffer, mimeType: 'image/jpeg' }],
      locationId: 'loc-1',
      buildSystem: () => 'sys',
      buildUserContent,
    });

    expect(resizeImageForAi).toHaveBeenCalledTimes(1);
    expect(resizeImageForAi).toHaveBeenCalledWith(originalBuffer, 'image/jpeg');
    expect(capturedImageParts).toHaveLength(1);
    expect(capturedImageParts[0].image).toEqual(Buffer.from('RESIZED'));
    expect(capturedImageParts[0].mimeType).toBe('image/webp');
  });
});
