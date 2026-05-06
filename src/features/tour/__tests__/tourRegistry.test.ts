import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINOLOGY } from '@/lib/terminology';
import { listTours, TOURS } from '../tourRegistry';
import { filterSteps, resolveRoute, resolveSelector, type TourContext } from '../tourSteps';

function makeContext(overrides: Partial<TourContext> = {}): TourContext {
  return {
    canWrite: true,
    aiEnabled: true,
    firstBinId: 'abc123',
    binIds: ['abc123', 'def456'],
    terminology: DEFAULT_TERMINOLOGY,
    isMobile: false,
    openCommandInput: () => {},
    closeCommandInput: () => {},
    ...overrides,
  };
}

function collectTsxFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      files.push(...collectTsxFiles(full));
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('tour registry', () => {
  const expectedIds = [
    'highlights',
    'create-ai',
    'ask-ai',
    'bin-anatomy',
    'print-scan',
    'reorganize',
    'bulk-edit',
  ];

  it('registers every TourId exactly once', () => {
    expect(Object.keys(TOURS).sort()).toEqual([...expectedIds].sort());
  });

  it.each(listTours())('tour $id has a non-empty steps array', (tour) => {
    expect(tour.steps.length).toBeGreaterThan(0);
  });

  it.each(listTours())('tour $id has a title and summary', (tour) => {
    expect(tour.title.length).toBeGreaterThan(0);
    expect(tour.summary.length).toBeGreaterThan(0);
  });

  it('only highlights auto-fires', () => {
    const autoFiring = listTours().filter((t) => t.autoFire);
    expect(autoFiring.map((t) => t.id)).toEqual(['highlights']);
  });

  it('every step resolves a non-empty route and selector for the default context', () => {
    const ctx = makeContext();
    for (const tour of listTours()) {
      const filtered = filterSteps(tour.steps, ctx);
      for (const step of filtered) {
        expect(resolveRoute(step, ctx), `route for ${tour.id}.${step.id}`).toMatch(/^\//);
        expect(resolveSelector(step, ctx), `selector for ${tour.id}.${step.id}`).toBeTruthy();
      }
    }
  });

  it('every static data-tour selector has a matching anchor in the codebase', () => {
    const selectors = new Set<string>();
    for (const tour of listTours()) {
      for (const step of tour.steps) {
        if (typeof step.selector === 'string') {
          const match = step.selector.match(/\[data-tour="([^"]+)"\]/);
          if (match) selectors.add(match[1]);
        }
      }
    }
    const cwd = path.resolve(__dirname, '../../../..');
    const srcDir = path.join(cwd, 'src');
    const allFiles = collectTsxFiles(srcDir);
    const fileContents: string[] = allFiles
      .filter((f) => !f.includes('/features/tour/tours/'))
      .map((f) => fs.readFileSync(f, 'utf8'));
    // Accept either a literal data-tour="X" attribute or a forwarded
    // dataTour="X" JSX prop — components like ShutterButton bind data-tour
    // dynamically from a prop, so the literal attribute string is absent
    // from the leaf source even though the runtime DOM has it.
    const missing = [...selectors].filter(
      (sel) =>
        !fileContents.some(
          (content) =>
            content.includes(`data-tour="${sel}"`) ||
            content.includes(`dataTour="${sel}"`),
        ),
    );
    expect(missing, `missing data-tour anchors: ${missing.join(', ')}`).toEqual([]);
  });

  it('filterSteps skips write-gated steps for viewer-role users', () => {
    const binTour = TOURS['bin-anatomy'];
    const viewerCtx = makeContext({ canWrite: false });
    const filtered = filterSteps(binTour.steps, viewerCtx);
    expect(filtered.map((s) => s.id)).not.toContain('quick-add');
  });
});
