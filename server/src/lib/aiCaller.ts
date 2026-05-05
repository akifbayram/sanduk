import { generateText } from 'ai';
import { mapSdkError } from './aiErrors.js';
import { resolvePinnedFetch } from './aiSsrf.js';
import { createSdkModel } from './sdkProviderFactory.js';

export type AiProviderType = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible';

export interface AiProviderConfig {
  provider: AiProviderType;
  apiKey: string;
  model: string;
  endpointUrl: string | null;
}

export async function testProviderConnection(config: AiProviderConfig, isDemoUser = false): Promise<void> {
  const pinnedFetch = await resolvePinnedFetch(config.endpointUrl, isDemoUser);
  const model = createSdkModel(config, pinnedFetch);
  try {
    await generateText({
      model,
      messages: [{ role: 'user' as const, content: 'Reply with OK' }],
      maxOutputTokens: 10,
    });
  } catch (err) {
    throw mapSdkError(err);
  }
}
