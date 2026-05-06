import type { CommandAction } from './commandParser.js';
import { ValidationError } from './httpErrors.js';

export const MAX_AREA_NAME = 255;

export type OperationType = CommandAction['type'];
export type OpInput = Record<string, unknown>;

export function fail(index: number, message: string): never {
  throw new ValidationError(`operations[${index}]: ${message}`);
}

export function requireString(op: OpInput, field: string, index: number, opType: OperationType): string {
  const value = op[field];
  if (!value || typeof value !== 'string') {
    fail(index, `${opType} requires "${field}"`);
  }
  return value;
}

export function optionalString(op: OpInput, field: string): string | undefined {
  const value = op[field];
  return typeof value === 'string' ? value : undefined;
}

export function optionalTrimmedString(op: OpInput, field: string): string | undefined {
  const value = op[field];
  return typeof value === 'string' ? value.trim() : undefined;
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function requireNonEmptyArray(op: OpInput, field: string, index: number, opType: OperationType): unknown[] {
  const value = op[field];
  if (!Array.isArray(value) || value.length === 0) {
    fail(index, `${opType} requires non-empty "${field}" array`);
  }
  return value;
}

export function optionalRecord(value: unknown): Record<string, string> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : undefined;
}

export function binName(op: OpInput): string {
  return (op.bin_name as string) || '';
}

export function validateAreaName(value: unknown, index: number): void {
  if (typeof value === 'string' && value.length > MAX_AREA_NAME) {
    fail(index, `area_name exceeds ${MAX_AREA_NAME} characters`);
  }
}

export function normalizeAddItems(raw: unknown[]): (string | { name: string; quantity?: number })[] {
  const result: (string | { name: string; quantity?: number })[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      result.push(item.trim());
    } else if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
      const obj = item as { name: string; quantity?: unknown };
      const name = obj.name.trim();
      if (!name) continue;
      const entry: { name: string; quantity?: number } = { name };
      if (typeof obj.quantity === 'number' && obj.quantity > 0) entry.quantity = obj.quantity;
      result.push(entry);
    }
  }
  return result;
}

/** Filter create_bin items to preserve either strings or {name} objects (schema-compatible with CommandAction). */
export function filterCreateBinItems(value: unknown): (string | { name: string; quantity?: number })[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((i): i is string | { name: string; quantity?: number } =>
    typeof i === 'string' ||
    (!!i && typeof i === 'object' && typeof (i as { name?: unknown }).name === 'string'),
  );
}
