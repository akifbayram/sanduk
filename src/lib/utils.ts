import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats seconds as M:SS for recording timers. */
export function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Returns `singular` when count === 1, otherwise `pluralForm` (defaults to singular + "s"). */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/** "1 item" / "5 items" / "2 children" — count + space + word, with optional explicit plural. */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

export const EMAIL_REGEX = /^[^\s@+]+@[^\s@]+\.[^\s@]+$/;

/** Returns the first whitespace-separated token of a name (e.g. "John Smith" → "John"). */
export function firstName(name: string | null | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

export function haptic(pattern: number | number[] = 10) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

/** Extract a human-readable message from an unknown catch value. */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

/** Format a byte count as B/KB/MB/GB with one-decimal precision. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Returns true if `url` uses http: or https: protocol (blocks javascript:, data:, etc.). */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

// ── Shared UI class constants ──────────────────────────────────────

/** Focus ring used on buttons, switches, checkboxes, and similar interactive controls. */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';

/** Shared disabled styling for interactive elements. */
export const disabledClasses = 'disabled:cursor-not-allowed disabled:opacity-50';

/** Base classes shared by Input, Textarea, and similar form controls. */
export const inputBase =
  'w-full rounded-[var(--radius-sm)] bg-[var(--bg-input)] border border-[var(--border-flat)] px-3.5 py-2.5 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-all duration-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/** Flat card base — shared by Card, Table, ListItem. */
export const flatCard = 'flat-card rounded-[var(--radius-lg)]';

/** Overlay backdrop — shared by Dialog and CommandPalette. */
export const overlayBackdrop =
  'fixed inset-0 bg-[var(--overlay-backdrop)] transition-opacity';

/** Small uppercase category/section header text. See `.ui-eyebrow` in index.css. */
export const categoryHeader = 'ui-eyebrow';

/** Section header: 10px semibold in primary text color. */
export const sectionHeader = 'text-[13px] text-[var(--text-primary)]';

/** Section header row: baseline-aligned title on the left, actions on the right. */
export const sectionHeaderRow = 'flex items-baseline justify-between mb-4';

/** Inline icon-button: 36px tap target, flex-centered. */
export const iconButton = 'shrink-0 flex items-center justify-center size-9';

/** Standard top-right close button for dialogs/overlays: 44px tap target, filled chip. */
export const closeButton =
  'absolute right-2.5 top-2.5 z-10 rounded-[var(--radius-sm)] h-11 w-11 bg-[var(--bg-input)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-center';

/** Sticky footer for flush-mode dialog bodies (px-5 padding). Caller supplies its own layout (row-spread, flex justify-end, etc.). */
export const stickyDialogFooter =
  'mt-auto sticky bottom-0 -mx-5 bg-[var(--bg-flat-heavy)] border-t border-[var(--border-subtle)] px-5 pt-3 pb-[calc(12px+var(--safe-bottom))]';

/** Fade-in-on-hover remove button for list rows (visible at 30% on mobile).
 *  44×44 touch target meets WCAG / platform minimums. */
export const rowAction =
  'shrink-0 flex items-center justify-center size-11 text-[var(--text-tertiary)] opacity-30 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity';

/** Human-readable relative time string from an ISO timestamp (e.g. "5m ago", "3d ago"). */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Short numeric date string (M/D/YYYY) from an ISO timestamp. */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}
