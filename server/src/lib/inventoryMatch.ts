/**
 * Pure-function helpers used by the deterministic inventory matcher.
 *
 * Future work: SQLite FTS5 / Postgres tsvector would replace the in-app
 * normalization for performance at scale. Out of scope per spec.
 */

/** Lowercase, drop punctuation (keep letters/numbers/whitespace), collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Naive English plural stem. Handles common cases without external deps:
 *   batteries → battery, cables → cable, boxes → box, glass → glass.
 * NEVER returns shorter than 3 chars.
 */
export function simplePluralStem(word: string): string {
  const w = word.toLowerCase();
  if (w.length >= 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  // Strip 'es' (2 chars) only for sibilant-stem plurals (boxes, foxes, buzzes).
  // Words like 'cables' are stem-ends-in-e + s; the plain-s rule handles those.
  // Sibilants that require 'es' in English: x, z, s (non-ss already filtered), ch, sh.
  if (w.length >= 4 && w.endsWith('es') && !w.endsWith('ses')) {
    const charBeforeEs = w[w.length - 3]; // 'x' in boxes, 'l' in cables, 'c' in races
    // Conservative sibilant set: only x and z (boxes → box, buzzes → buzz).
    // Anything else falls through to the plain-s rule, which preserves a stem
    // ending in 'e' (cables → cable, races → race, places → place).
    if (charBeforeEs === 'x' || charBeforeEs === 'z') {
      return w.slice(0, -2);
    }
  }
  if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Normalize, then plural-stem each token, then rejoin with single spaces. */
export function normalizeForCompare(s: string): string {
  const n = normalizeForMatch(s);
  if (!n) return '';
  return n.split(' ').map(simplePluralStem).join(' ');
}

/** Tokenize via `normalizeForCompare`. Returns empty array for empty input. */
export function tokensForMatch(s: string): string[] {
  const n = normalizeForCompare(s);
  return n ? n.split(' ') : [];
}
