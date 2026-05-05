import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AiAnalysisError, toSafeAiMessage } from './aiErrors.js';
import { aiErrorToStatus, NoAiSettingsError } from './aiSettings.js';
import { HttpError, ValidationError } from './httpErrors.js';
import { createLogger } from './logger.js';

const log = createLogger('ai');

/** Wrap an async AI route handler with standard error handling. */
export function aiRouteHandler(
  action: string,
  fn: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        next(err);
        return;
      }
      if (err instanceof AiAnalysisError) {
        const message = toSafeAiMessage(err);
        if (err.code === 'PROVIDER_ERROR') {
          const safeErr = { message: err.message, name: err.name, code: err.code };
          log.error(`${action} provider error:`, safeErr);
        }
        res.status(aiErrorToStatus(err.code)).json({ error: message, code: err.code });
        return;
      }
      if (err instanceof NoAiSettingsError) {
        res.status(422).json({ error: 'VALIDATION_ERROR', message: err.message });
        return;
      }
      if (err instanceof ValidationError) {
        res.status(422).json({ error: 'VALIDATION_ERROR', message: err.message });
        return;
      }
      // Redact potentially sensitive fields (auth headers, API keys) from external provider errors
      const safeErr = err instanceof Error ? { message: err.message, name: err.name } : '[non-Error thrown]';
      log.error(`${action} error:`, safeErr);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: `Failed to ${action}` });
    }
  };
}

/** Validate a text input field: non-empty string, trimmed, within max length. */
export function validateTextInput(value: unknown, fieldName: string, maxLength = 5000): string {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${fieldName} is required`);
  }
  if (value.length > maxLength) {
    throw new ValidationError(`${fieldName} must be ${maxLength} characters or less`);
  }
  return value.trim();
}
