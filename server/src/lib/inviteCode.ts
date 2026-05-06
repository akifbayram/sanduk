import crypto from 'node:crypto';

export function generateInviteCode(): string {
  return crypto.randomBytes(16).toString('hex');
}
