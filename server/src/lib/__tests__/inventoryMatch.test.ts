import { describe, expect, it } from 'vitest';
import { normalizeForCompare, normalizeForMatch, simplePluralStem, tokensForMatch } from '../inventoryMatch.js';

describe('normalizeForMatch', () => {
  it('lowercases and trims', () => {
    expect(normalizeForMatch('  Hello WORLD  ')).toBe('hello world');
  });
  it('strips punctuation but keeps letters/digits/spaces', () => {
    expect(normalizeForMatch('AA-batteries, 4×!')).toBe('aa batteries 4');
  });
  it('collapses whitespace', () => {
    expect(normalizeForMatch('a   b\t\nc')).toBe('a b c');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeForMatch('')).toBe('');
  });
});

describe('simplePluralStem', () => {
  it('strips trailing s on words ≥4 chars', () => {
    expect(simplePluralStem('tools')).toBe('tool');
    expect(simplePluralStem('cables')).toBe('cable');
  });
  it('handles ies → y', () => {
    expect(simplePluralStem('batteries')).toBe('battery');
  });
  it('does not double-strip ss', () => {
    expect(simplePluralStem('glass')).toBe('glass');
    expect(simplePluralStem('dress')).toBe('dress');
  });
  it('leaves short words alone', () => {
    expect(simplePluralStem('us')).toBe('us');
    expect(simplePluralStem('is')).toBe('is');
  });
  it('handles es ending after sibilant x or z', () => {
    expect(simplePluralStem('boxes')).toBe('box');
    expect(simplePluralStem('buzzes')).toBe('buzz');
  });
  it('preserves stem-ending-e plurals (does not over-strip after non-sibilant + es)', () => {
    expect(simplePluralStem('races')).toBe('race');
    expect(simplePluralStem('places')).toBe('place');
    expect(simplePluralStem('dices')).toBe('dice');
  });
});

describe('normalizeForCompare', () => {
  it('chains normalize + per-token plural stem', () => {
    expect(normalizeForCompare('Tools, Batteries, & Cables!')).toBe('tool battery cable');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeForCompare('')).toBe('');
  });
});

describe('tokensForMatch', () => {
  it('returns plural-stemmed tokens', () => {
    expect(tokensForMatch('Tools and Batteries')).toEqual(['tool', 'and', 'battery']);
  });
  it('returns empty array for empty input', () => {
    expect(tokensForMatch('')).toEqual([]);
  });
});
