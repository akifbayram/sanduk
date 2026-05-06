import { query } from '../db.js';

/**
 * Resolve the active registration mode. Env-var override (REGISTRATION_MODE)
 * wins over the runtime setting in the `settings` table.
 */
export async function getRegistrationMode(): Promise<string> {
  if (process.env.REGISTRATION_MODE) {
    const mode = process.env.REGISTRATION_MODE;
    if (mode === 'invite' || mode === 'closed') return mode;
    return 'open';
  }
  const result = await query<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'registration_mode'",
  );
  return result.rows[0]?.value || 'open';
}
