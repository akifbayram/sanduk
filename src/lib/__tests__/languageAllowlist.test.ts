import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../i18n';

// Client and server are separate builds with no shared package, so
// server/src/routes/auth/profile.ts hand-maintains its own SUPPORTED_LANGUAGE_CODES
// allowlist rather than importing this one. This test reads that file as plain
// text (not importing it — it depends on server-only packages) so CI fails
// loudly if the two lists ever drift apart, instead of silently 422ing every
// PUT /api/auth/profile for a locale the UI already offers.
describe('server language allowlist stays in sync with SUPPORTED_LANGUAGES', () => {
  it('profile.ts validates against the same codes as the client', () => {
    const profilePath = path.resolve(__dirname, '../../../server/src/routes/auth/profile.ts');
    const source = fs.readFileSync(profilePath, 'utf-8');
    const match = source.match(/SUPPORTED_LANGUAGE_CODES\s*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();

    const serverCodes = match![1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    const clientCodes = SUPPORTED_LANGUAGES.map((l) => l.code);

    expect(new Set(serverCodes)).toEqual(new Set(clientCodes));
  });
});
