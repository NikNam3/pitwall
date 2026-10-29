// The screenshot baselines stay few (user decision): which gallery cells have one (gallery/cells.ts `hasBaseline`), and
// a budget for how many PNGs `apps/ui/e2e/__screenshots__/` may hold.
import { describe, expect, it } from 'vitest';
import { hasBaseline, type CellSource, type WidgetCell } from '../../src/gallery/cells.ts';
import { DEFAULT_THEME, THEMES } from '../../src/theme/index.ts';

/**
 * At most this many baselines for the whole app: about two per display (its first case at compact and at full, default
 * theme) plus the frame states, the kit parts and the shell cells. Raising it is a deliberate decision, not a fix for a
 * failing check: prefer fewer cells.
 */
const SCREENSHOT_BUDGET = 40;

/** The baseline files, by path (listed, not loaded). */
const baselines = Object.keys(import.meta.glob('../../e2e/__screenshots__/*.png'));

describe('screenshot baselines', () => {
  it(`there are at most ${SCREENSHOT_BUDGET}`, () => {
    expect(baselines.length).toBeGreaterThan(0);
    expect(baselines.length).toBeLessThanOrEqual(SCREENSHOT_BUDGET);
  });
});

describe('hasBaseline', () => {
  const other = THEMES.find((t) => t.name !== DEFAULT_THEME.name) ?? DEFAULT_THEME;
  const cell = (size: { id: string; mode: string }, data: WidgetCell['data'], theme = DEFAULT_THEME): WidgetCell =>
    ({ id: 'x', widget: undefined as never, size: { ...size, cols: 1, rows: 1 }, data, theme }) as WidgetCell;
  const compact = { id: 'compact', mode: 'compact' };
  const withCases: CellSource = { moments: ['m1'], cases: { first: {}, second: {} } };

  it('is the first case at a mode minimum in the default theme', () => {
    expect(hasBaseline(cell(compact, { kind: 'case', name: 'first' }), withCases, DEFAULT_THEME.name)).toBe(true);
    expect(hasBaseline(cell({ id: 'full', mode: 'full' }, { kind: 'case', name: 'first' }), withCases, DEFAULT_THEME.name)).toBe(true);
  });
  it('is not another case, a moment, a fit size or another theme', () => {
    expect(hasBaseline(cell(compact, { kind: 'case', name: 'second' }), withCases, DEFAULT_THEME.name)).toBe(false);
    expect(hasBaseline(cell(compact, { kind: 'moment', name: 'm1' }), withCases, DEFAULT_THEME.name)).toBe(false);
    expect(hasBaseline(cell({ id: 'compact-40x5', mode: 'compact' }, { kind: 'case', name: 'first' }), withCases, DEFAULT_THEME.name)).toBe(false);
    if (other !== DEFAULT_THEME) expect(hasBaseline(cell(compact, { kind: 'case', name: 'first' }, other), withCases, DEFAULT_THEME.name)).toBe(false);
  });
  it('is the first moment of a widget without cases', () => {
    expect(hasBaseline(cell(compact, { kind: 'moment', name: 'm1' }), { moments: ['m1', 'm2'] }, DEFAULT_THEME.name)).toBe(true);
    expect(hasBaseline(cell(compact, { kind: 'moment', name: 'm2' }), { moments: ['m1', 'm2'] }, DEFAULT_THEME.name)).toBe(false);
  });
});
