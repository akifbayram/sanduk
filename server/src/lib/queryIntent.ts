import { tokensForMatch } from './inventoryMatch.js';

export type MetadataIntent = 'pinned' | 'private' | 'checked_out' | 'trashed';

const PINNED_RE = /\bpinned?\b/;
const PRIVATE_RE = /\bprivate\b/;
const CHECKED_OUT_RE = /\b(checked\s*out|check[ -]?out|checkout)\b/;
const TRASHED_RE = /\b(in\s+(the\s+)?trash|trashed|deleted\s+bins?|recycling)\b/;

/**
 * Recognise the four metadata-only query shapes. Returns `null` when the
 * question is about content (the substring matcher takes over).
 */
export function classifyMetadataIntent(text: string): MetadataIntent | null {
  const t = text.toLowerCase();
  if (CHECKED_OUT_RE.test(t)) return 'checked_out';
  if (TRASHED_RE.test(t)) return 'trashed';
  if (PINNED_RE.test(t)) return 'pinned';
  if (PRIVATE_RE.test(t)) return 'private';
  return null;
}

/**
 * Stop words that question phrasings sprinkle around the actual content terms.
 * Anything in this list is dropped from `extractContentTerms` output. Keep
 * lowercase, plural-stemmed (matches what `tokensForMatch` produces).
 */
const STOP_WORDS = new Set<string>([
  'a', 'an', 'the', 'my', 'our', 'their', 'his', 'her', 'its',
  'where', 'what', 'whats', 'which', 'who', 'whose', 'how', 'do',
  'have', 'has', 'had', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'we', 'you', 'they', 'me', 'us',
  'in', 'on', 'at', 'of', 'for', 'with', 'about', 'from', 'to', 'by',
  'and', 'or', 'but', 'so',
  'any', 'all', 'some', 'every', 'each',
  'find', 'show', 'list', 'tell', 'give',
  'thing', 'item', 'bin', 'box', 'container',
  'many', 'much', 'lot', 'lots',
  'something', 'anything', 'nothing',
  'please', 'can', 'could', 'would', 'will', 'should',
]);

/** Return the question's content tokens (plural-stemmed, stop-words removed). */
export function extractContentTerms(text: string): string[] {
  return tokensForMatch(text).filter((tok) => tok.length >= 2 && !STOP_WORDS.has(tok));
}
