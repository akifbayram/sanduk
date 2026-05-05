import bcrypt from 'bcrypt';
import { generateUuid, query } from '../../db.js';

// Pre-hashed sentinel used for constant-time rejection in anti-enumeration
// flows. The bcrypt cost factor matches a real hash; comparing against this
// when the user doesn't exist keeps response timing indistinguishable from a
// genuine "wrong password" rejection. Centralized here so the literal can't
// drift across callsites.
const DUMMY_BCRYPT_HASH = '$2b$12$000000000000000000000uVjKPCGJcotDu8bMahKn7VoPxpL0Wi';

/** Equalize timing for callers that bail before reaching real bcrypt.compare. */
export async function runConstantTimeBcryptCompare(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
}

/** Fire-and-forget login-history insert. Errors are swallowed by design. */
export function recordLoginAttempt(
  userId: string,
  ip: string | null,
  ua: string | null,
  method: string,
  success: boolean,
): void {
  query(
    'INSERT INTO login_history (id, user_id, ip_address, user_agent, method, success) VALUES ($1, $2, $3, $4, $5, $6)',
    [generateUuid(), userId, ip, ua, method, success ? 1 : 0],
  ).catch(() => {});
}
