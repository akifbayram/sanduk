export type AiErrorCode = 'INVALID_KEY' | 'RATE_LIMITED' | 'MODEL_NOT_FOUND' | 'INVALID_RESPONSE' | 'NETWORK_ERROR' | 'PROVIDER_ERROR';

export class AiAnalysisError extends Error {
  code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = 'AiAnalysisError';
    this.code = code;
  }
}

/** Safe client-facing messages keyed by AI error code (avoids leaking provider internals). */
const SAFE_AI_MESSAGES: Partial<Record<AiErrorCode, string>> = {
  INVALID_KEY: 'Invalid API key — check your AI provider settings',
  RATE_LIMITED: 'Rate limited by provider — try again later',
  MODEL_NOT_FOUND: 'Model not found — check your AI provider settings',
  INVALID_RESPONSE: 'Provider returned an invalid response',
  NETWORK_ERROR: 'Cannot connect to AI endpoint — check your endpoint URL',
};

/** Convert an AiAnalysisError to a safe, client-facing message string. */
export function toSafeAiMessage(err: { code: AiErrorCode; message: string }): string {
  return SAFE_AI_MESSAGES[err.code] ?? err.message;
}

/** Map Vercel AI SDK errors to AiAnalysisError. */
export function mapSdkError(err: unknown): AiAnalysisError {
  const e = err as { name?: string; status?: number; statusCode?: number; message?: string };
  const msg = e.message ?? 'Unknown provider error';
  const status = e.status ?? e.statusCode ?? 0;

  if (e.name === 'AI_APICallError' || e.name === 'APICallError') {
    if (status === 401 || status === 403) return new AiAnalysisError('INVALID_KEY', msg);
    if (status === 429) return new AiAnalysisError('RATE_LIMITED', msg);
    if (status === 404) return new AiAnalysisError('MODEL_NOT_FOUND', msg);
    return new AiAnalysisError('PROVIDER_ERROR', `Provider returned ${status}: ${msg.slice(0, 200)}`);
  }
  if (e.name === 'AI_LoadAPIKeyError') return new AiAnalysisError('INVALID_KEY', msg);
  if (e.name === 'AbortError' || e.name === 'TimeoutError' || msg.includes('timed out') || msg.includes('timeout')) {
    return new AiAnalysisError('NETWORK_ERROR', msg);
  }
  return new AiAnalysisError('PROVIDER_ERROR', msg.slice(0, 200));
}
