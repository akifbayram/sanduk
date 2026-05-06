import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { AiProviderConfig } from './aiCaller.js';
import { AiAnalysisError } from './aiErrors.js';

/**
 * Create a Vercel AI SDK LanguageModel from a per-user AiProviderConfig.
 *
 * Called on every request — SDK provider factories are cheap config objects
 * (no connection pooling), so per-request instantiation is correct and safe.
 */
export function createSdkModel(config: AiProviderConfig, customFetch?: typeof globalThis.fetch): LanguageModel {
  switch (config.provider) {
    case 'openai': {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpointUrl ?? undefined,
        fetch: customFetch,
      });
      return provider(config.model);
    }
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.endpointUrl ?? undefined,
        fetch: customFetch,
      });
      return provider(config.model);
    }
    case 'gemini': {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.endpointUrl ?? undefined,
        fetch: customFetch,
      });
      return provider(config.model);
    }
    case 'openai-compatible': {
      if (!config.endpointUrl) {
        throw new AiAnalysisError('NETWORK_ERROR', 'endpointUrl is required for openai-compatible provider');
      }
      const provider = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: config.endpointUrl,
        apiKey: config.apiKey,
        fetch: customFetch,
      });
      return provider(config.model);
    }
    default:
      throw new AiAnalysisError('PROVIDER_ERROR', `Unknown provider: ${(config as AiProviderConfig).provider}`);
  }
}
