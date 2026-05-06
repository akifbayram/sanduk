import { describe, expect, it } from 'vitest';
import { classifyMetadataIntent, extractContentTerms } from '../queryIntent.js';

describe('classifyMetadataIntent', () => {
  it('detects pinned intent', () => {
    expect(classifyMetadataIntent("what's pinned")).toBe('pinned');
    expect(classifyMetadataIntent('show me my pinned bins')).toBe('pinned');
  });
  it('detects private intent', () => {
    expect(classifyMetadataIntent("what's private")).toBe('private');
    expect(classifyMetadataIntent('which bins are private')).toBe('private');
  });
  it('detects checked-out intent', () => {
    expect(classifyMetadataIntent("what's checked out")).toBe('checked_out');
    expect(classifyMetadataIntent('list everything checkout out by alice')).toBe('checked_out');
  });
  it('detects trashed intent', () => {
    expect(classifyMetadataIntent("what's in the trash")).toBe('trashed');
    expect(classifyMetadataIntent('show me trashed bins')).toBe('trashed');
  });
  it('returns null for content questions', () => {
    expect(classifyMetadataIntent('which bin has battery')).toBeNull();
    expect(classifyMetadataIntent('where are my screwdrivers')).toBeNull();
    expect(classifyMetadataIntent("what's tagged tools")).toBeNull();
  });
});

describe('extractContentTerms', () => {
  it('strips question stop words', () => {
    expect(extractContentTerms('which bin has battery')).toEqual(['battery']);
    expect(extractContentTerms('where are my screwdrivers')).toEqual(['screwdriver']);
  });
  it('plural-stems tokens', () => {
    expect(extractContentTerms("what's tagged tools")).toEqual(['tagged', 'tool']);
  });
  it('drops single-char tokens and stop words', () => {
    expect(extractContentTerms('do I have a tent?')).toEqual(['tent']);
  });
  it('returns empty array for stop-word-only input', () => {
    expect(extractContentTerms('what about the bins?')).toEqual([]);
  });
  it('handles multi-term queries', () => {
    expect(extractContentTerms('find me a battery for the flashlight')).toEqual(['battery', 'flashlight']);
  });
});
