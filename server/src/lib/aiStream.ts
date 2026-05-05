import type { LanguageModel, ModelMessage, UserContent } from 'ai';
import { Output, streamText } from 'ai';
import type { Request, Response } from 'express';
import { mapSdkError, toSafeAiMessage } from './aiErrors.js';
import { config } from './config.js';
import { createLogger } from './logger.js';

/**
 * Per-provider streamText options. Currently bounds Gemini 3 thinking depth —
 * Gemini 3 Flash defaults to dynamic thinking which can multiply output-token
 * cost on complex prompts (e.g. photo analyses with many items). Capping via
 * `thinkingLevel` keeps reasoning-token spend predictable.
 *
 * Gemini 2.5 uses a numeric `thinkingBudget` instead; not handled here because
 * OpenBin currently routes vision/deepText to Gemini 3.
 */
type GoogleProviderOptions = {
  google: { thinkingConfig: { thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' } };
};
function buildProviderOptions(model: LanguageModel): GoogleProviderOptions | undefined {
  const id = (model as { modelId?: string }).modelId ?? '';
  if (/^gemini-3/i.test(id)) {
    return {
      google: {
        thinkingConfig: { thinkingLevel: config.geminiThinkingLevel },
      },
    };
  }
  return undefined;
}

/** Returns a signal that aborts on `req.close` OR baseSignal, whichever fires first. */
export function withClientDisconnect(req: Request, baseSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();

  if (baseSignal?.aborted) {
    controller.abort();
    return controller.signal;
  }

  baseSignal?.addEventListener('abort', () => controller.abort(), { once: true });
  req.once('close', () => controller.abort());

  return controller.signal;
}

const log = createLogger('ai');

export interface StreamOptions {
  system: string;
  userContent: UserContent;
  /** Zod schema — when provided, constrains the model to output valid JSON matching this shape. */
  schema?: Parameters<typeof Output.object>[0]['schema'];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  abortSignal?: AbortSignal;
  /** Prior conversation turns to prepend before the current user message. */
  priorMessages?: ModelMessage[];
  /**
   * Optional post-processing hook. When set, the final parsed JSON is passed
   * through this function before being emitted as the `done` event's text.
   * Used by query routes to enrich AI-returned matches with DB-resolved data.
   */
  enrichResult?: (parsed: unknown) => Promise<unknown>;
}

/** Set SSE headers on an Express response and return a typed event writer. */
export function initSseResponse(res: Response): (data: object) => void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  return (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

/**
 * Core streaming logic: stream AI output to an event writer.
 *
 * Returns the final cleaned text on success, or null on error/truncation.
 * The caller is responsible for sending `done`/managing the SSE lifecycle.
 */
export async function streamAiToWriter(
  writeEvent: (data: object) => void,
  model: LanguageModel,
  opts: StreamOptions,
): Promise<string | null> {
  try {
    const providerOptions = buildProviderOptions(model);
    const streamResult = streamText({
      model,
      ...(opts.schema ? { output: Output.object({ schema: opts.schema }) } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      system: opts.system,
      messages: [
        ...(opts.priorMessages ?? []),
        { role: 'user' as const, content: opts.userContent },
      ],
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
      topP: opts.topP,
      abortSignal: opts.abortSignal,
    });

    for await (const delta of streamResult.textStream) {
      writeEvent({ type: 'delta', text: delta });
    }

    let finalText = await streamResult.text;

    // When structured output is requested, prefer the validated output object.
    if (opts.schema) {
      try {
        const output = await streamResult.output;
        if (output) finalText = JSON.stringify(output);
      } catch {
        // output parsing failed — fall through to raw text
      }
    }

    // Guard against truncated JSON
    if (finalText.trim()) {
      let cleaned = finalText.trim();
      const fenced = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      if (fenced) cleaned = fenced[1].trim();

      try {
        JSON.parse(cleaned);
        finalText = cleaned;
      } catch {
        writeEvent({ type: 'error', message: 'AI response was cut short — try a shorter query or increase max tokens', code: 'TRUNCATED_RESPONSE' });
        return null;
      }
    }

    return finalText;
  } catch (err) {
    const mapped = mapSdkError(err);
    const safeMessage = toSafeAiMessage(mapped) || 'Provider error — check server logs';
    if (mapped.code === 'PROVIDER_ERROR') {
      const safeErr = err instanceof Error ? { message: err.message, name: err.name } : '[non-Error thrown]';
      log.error('Stream error:', safeErr);
    }
    writeEvent({ type: 'error', message: safeMessage, code: mapped.code });
    return null;
  }
}

/**
 * Stream AI output as SSE to an Express response.
 *
 * Convenience wrapper around streamAiToWriter that manages the full SSE
 * lifecycle (headers, done event, res.end).
 *
 * Protocol: each SSE `data:` event carries one of:
 *   { type: 'delta', text: string }   — incremental text chunk
 *   { type: 'done', text: string }    — full accumulated text on finish
 *   { type: 'error', message: string, code: string } — error event
 */
export async function pipeAiStreamToResponse(
  res: Response,
  model: LanguageModel,
  opts: StreamOptions
): Promise<string | null> {
  const writeEvent = initSseResponse(res);
  try {
    const result = await streamAiToWriter(writeEvent, model, opts);
    if (result) {
      let finalText = result;
      if (opts.enrichResult) {
        try {
          const parsed = JSON.parse(result);
          const enriched = await opts.enrichResult(parsed);
          finalText = JSON.stringify(enriched);
        } catch (err) {
          log.error('enrichResult failed:', err instanceof Error ? err.message : '[non-Error]');
          // Fall back to un-enriched result so the client isn't left hanging.
        }
      }
      writeEvent({ type: 'done', text: finalText });
      return finalText;
    }
    return result;
  } finally {
    res.end();
  }
}
