import { pluralize } from '@/lib/utils';
import type { QueryMatch } from './useInventoryQuery';

export type DisplayMode = 'header-only' | 'inline-disclosure' | 'nav-disclosure';
export type RelevanceKind = 'item' | 'name' | 'tag' | 'metadata' | 'fuzzy' | 'unknown';

export interface MatchDisplay {
  mode: DisplayMode;
  defaultExpanded: boolean;
  countLabel: string;
}

const METADATA_HINTS = new Set([
  'pinned',
  'private',
  'in trash',
  'has checked-out items',
]);

/**
 * Maps the server-side `relevance` string (from `describeMatchHint` and the
 * metadata matchers in server/src/lib/inventoryMatcher.ts) to a typed kind.
 *
 * If those server strings ever change format, the test suite for this file
 * will fail loudly.
 */
export function parseRelevanceKind(relevance: string): RelevanceKind {
  if (!relevance) return 'unknown';
  if (relevance.startsWith('contains "')) return 'item';
  if (relevance.startsWith('name contains "')) return 'name';
  if (relevance.startsWith('tagged "')) return 'tag';
  if (METADATA_HINTS.has(relevance)) return 'metadata';
  if (relevance === 'name similar to query') return 'fuzzy';
  return 'unknown';
}

export function getMatchDisplay(match: QueryMatch): MatchDisplay {
  const itemsCount = match.items.length;
  const totalCount = match.total_item_count;

  if (itemsCount === 0 && totalCount === 0) {
    return { mode: 'header-only', defaultExpanded: false, countLabel: '' };
  }
  if (itemsCount === 0) {
    return {
      mode: 'nav-disclosure',
      defaultExpanded: false,
      countLabel: pluralize(totalCount, 'item'),
    };
  }
  const kind = parseRelevanceKind(match.relevance);
  return {
    mode: 'inline-disclosure',
    defaultExpanded: kind === 'item' && itemsCount === 1,
    // Pill shows MATCHED item count; BinItemGroup's "+N more" footer covers the delta to total.
    countLabel: pluralize(itemsCount, 'item'),
  };
}
