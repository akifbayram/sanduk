import { d, getDialect, query } from '../db.js';
import { createLogger } from './logger.js';

const log = createLogger('markAiAsked');

/**
 * Sets `ai_asked_at` to the current time on the user's preferences JSON blob,
 * but only if it isn't already set. Fire-and-forget; never throws.
 *
 * Called from the three AI streaming route handlers after a successful LLM
 * response. Used by the dashboard onboarding checklist to flip step 3.
 */
export async function markAiAsked(userId: string): Promise<void> {
  try {
    const ts = new Date().toISOString();
    if (getDialect() === 'sqlite') {
      await query(
        `UPDATE user_preferences
           SET settings = json_set(settings, '$.ai_asked_at', $1),
               updated_at = ${d.now()}
         WHERE user_id = $2
           AND (json_extract(settings, '$.ai_asked_at') IS NULL
             OR json_extract(settings, '$.ai_asked_at') = '')`,
        [ts, userId],
      );
    } else {
      await query(
        `UPDATE user_preferences
           SET settings = jsonb_set(settings::jsonb, '{ai_asked_at}', to_jsonb($1::text), true)::text,
               updated_at = ${d.now()}
         WHERE user_id = $2
           AND (settings::jsonb -> 'ai_asked_at' IS NULL
             OR settings::jsonb ->> 'ai_asked_at' = '')`,
        [ts, userId],
      );
    }
  } catch (err) {
    log.warn('markAiAsked failed', { err: String(err), userId });
  }
}
