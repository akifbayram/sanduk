import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import OpenAI from 'openai';
import type { AiProviderConfig } from './aiCaller.js';
import { AiAnalysisError, mapSdkError } from './aiErrors.js';
import { resolvePinnedFetch } from './aiSsrf.js';
import type { StructureTextOverrides } from './structureText.js';

export interface TranscribeResult {
  text: string;
}

/**
 * Transcribe audio to text using the user's configured AI provider.
 *
 * - OpenAI / OpenAI-compatible: calls the Whisper-compatible /audio/transcriptions endpoint.
 * - Gemini: sends audio as inline_data to the generative model.
 * - Anthropic: not supported (caller must gate before reaching here).
 */
export async function transcribeAudio(
  config: AiProviderConfig,
  audioBuffer: Buffer,
  mimeType: string,
  overrides?: StructureTextOverrides,
): Promise<TranscribeResult> {
  const pinnedFetch = await resolvePinnedFetch(config.endpointUrl);

  switch (config.provider) {
    case 'openai':
    case 'openai-compatible':
      return transcribeOpenAI(config, audioBuffer, mimeType, pinnedFetch, overrides);
    case 'gemini':
      return transcribeGemini(config, audioBuffer, mimeType, pinnedFetch, overrides);
    case 'anthropic':
      throw new AiAnalysisError('PROVIDER_ERROR', 'Anthropic does not support audio transcription. Switch to OpenAI or Gemini for dictation.');
    default:
      throw new AiAnalysisError('PROVIDER_ERROR', `Unknown provider: ${config.provider}`);
  }
}

async function transcribeOpenAI(
  config: AiProviderConfig,
  audioBuffer: Buffer,
  mimeType: string,
  pinnedFetch?: typeof globalThis.fetch,
  overrides?: StructureTextOverrides,
): Promise<TranscribeResult> {
  const baseURL = config.endpointUrl ?? 'https://api.openai.com/v1';
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL,
    fetch: pinnedFetch,
    timeout: overrides?.request_timeout ? overrides.request_timeout * 1000 : 60_000,
  });

  try {
    const file = new File([new Uint8Array(audioBuffer)], 'audio.webm', { type: mimeType });
    const response = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });
    return { text: response.text };
  } catch (err) {
    throw mapSdkError(err);
  }
}

async function transcribeGemini(
  config: AiProviderConfig,
  audioBuffer: Buffer,
  mimeType: string,
  pinnedFetch?: typeof globalThis.fetch,
  overrides?: StructureTextOverrides,
): Promise<TranscribeResult> {
  const provider = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: config.endpointUrl ?? undefined,
    fetch: pinnedFetch,
  });

  try {
    const result = await generateText({
      model: provider(config.model),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              data: audioBuffer,
              mediaType: mimeType,
            },
            {
              type: 'text',
              text: 'Transcribe this audio exactly as spoken. Return only the transcribed text, nothing else.',
            },
          ],
        },
      ],
      maxOutputTokens: overrides?.max_tokens ?? 2000,
      temperature: 0,
      abortSignal: overrides?.request_timeout
        ? AbortSignal.timeout(overrides.request_timeout * 1000)
        : undefined,
    });
    return { text: result.text.trim() };
  } catch (err) {
    throw mapSdkError(err);
  }
}
