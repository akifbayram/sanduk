import { COLOR_KEY_REGEX } from '../../lib/binValidation.js';
import { config } from '../../lib/config.js';
import { SelectionTooLargeError, ValidationError } from '../../lib/httpErrors.js';
import { HEX_COLOR_REGEX } from '../../lib/validation.js';

export const TAG_REGEX = /^[a-z0-9][a-z0-9-]{0,99}$/;
export const MAX_BINS_PER_APPLY = 500;

export function isValidTagColor(color: string): boolean {
  if (color === '') return true;
  return HEX_COLOR_REGEX.test(color) || COLOR_KEY_REGEX.test(color);
}

export function validateTagNames(tags: unknown, fieldName = 'tags'): string[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty array`);
  }
  if (tags.length > config.bulkMaxSelection) {
    throw new SelectionTooLargeError(config.bulkMaxSelection, tags.length);
  }
  for (const t of tags) {
    if (typeof t !== 'string' || !TAG_REGEX.test(t)) {
      throw new ValidationError(`Invalid tag name in ${fieldName}: ${t}`);
    }
  }
  return [...new Set(tags as string[])];
}
