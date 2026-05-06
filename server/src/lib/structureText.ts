import { generateObject } from 'ai';
import type { AiProviderConfig } from './aiCaller.js';
import { mapSdkError } from './aiErrors.js';
import type { AiSuggestedItem } from './aiProviders.js';
import { normalizeAiItems } from './aiProviders.js';
import { resolvePrompt } from './aiSanitize.js';
import { StructureTextSchema } from './aiSchemas.js';
import { resolvePinnedFetch } from './aiSsrf.js';
import { DEFAULT_STRUCTURE_PROMPT } from './defaultPrompts.js';
import { createSdkModel } from './sdkProviderFactory.js';

export interface StructureTextRequest {
  text: string;
  mode: 'items';
  context?: {
    binName?: string;
    existingItems?: string[];
  };
}

export interface StructureTextResult {
  items: AiSuggestedItem[];
}

export function buildPrompt(request: StructureTextRequest, customPrompt?: string, isDemoUser?: boolean): string {
  let prompt = resolvePrompt(DEFAULT_STRUCTURE_PROMPT, customPrompt, isDemoUser);

  if (request.context?.binName) {
    prompt += `\n\nBin name: "${request.context.binName}" — use this for context about what type of items to expect.`;
  }

  if (request.context?.existingItems && request.context.existingItems.length > 0) {
    prompt += `\n\nExisting items already in this bin: ${JSON.stringify(request.context.existingItems)}. Do NOT include these in your response — only return NEW items from the dictation.`;
  }

  return prompt;
}

function validateItems(raw: unknown): StructureTextResult {
  const obj = raw as Record<string, unknown>;
  let items: AiSuggestedItem[] = [];
  if (Array.isArray(obj.items)) {
    items = normalizeAiItems(obj.items).slice(0, 500);
  }
  return { items };
}

/** Default maxOutputTokens for structure-text parsing. */
export const STRUCTURE_TEXT_TOKENS = 1200;

export interface StructureTextOverrides {
  temperature?: number | null;
  max_tokens?: number | null;
  top_p?: number | null;
  request_timeout?: number | null;
}

export async function structureText(
  config: AiProviderConfig,
  request: StructureTextRequest,
  customPrompt?: string,
  overrides?: StructureTextOverrides,
  isDemoUser?: boolean
): Promise<StructureTextResult> {
  const pinnedFetch = await resolvePinnedFetch(config.endpointUrl);
  const model = createSdkModel(config, pinnedFetch);

  try {
    const result = await generateObject({
      model,
      schema: StructureTextSchema,
      system: buildPrompt(request, customPrompt, isDemoUser),
      messages: [{ role: 'user' as const, content: request.text }],
      maxOutputTokens: overrides?.max_tokens ?? STRUCTURE_TEXT_TOKENS,
      temperature: overrides?.temperature ?? 0.2,
      topP: overrides?.top_p ?? undefined,
      abortSignal: overrides?.request_timeout
        ? AbortSignal.timeout(overrides.request_timeout * 1000)
        : undefined,
    });
    // Post-process: business rule sanitization that Zod cannot express
    return validateItems(result.object);
  } catch (err) {
    throw mapSdkError(err);
  }
}
