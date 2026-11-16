// The screenshot baselines stay few (user decision): which gallery cells have one (gallery/cells.ts `hasBaseline`), and
// a budget for how many PNGs `apps/ui/e2e/__screenshots__/` may hold.
import { describe, expect, it } from 'vitest';
import { hasBaseline, type CellSource, type WidgetCell } from '../../src/gallery/cells.ts';
import { DEFAULT_THEME, THEMES } from '../../src/theme/index.ts';

/**
 * The baseline budget (user ruling 2026-11-16, SP4.3d1 Task 15; replaces the fixed 58): at most 2 baselines per
 * registered display (its first case at compact and at full, default theme) plus 5 misc (top bar, shell, kit, frame
 * states). Raising it is a deliberate decision, not a fix for a failing check: prefer fewer cells.
 */
const PER_DISPLAY = 2;
const MISC = 5;

/** The registered displays, by their folder name (each has a `register.ts`). */
const displays = Object.keys(import.meta.glob('../../src/widgets/*/register.ts')).map((p) => p.split('/').at(-2) ?? '');
const SCREENSHOT_BUDGET = PER_DISPLAY * displays.length + MISC;

/** The baseline files, by name (listed, not loaded). */
const baselines = Object.keys(import.meta.glob('../../e2e/__screenshots__/*.png')).map((p) => p.split('/').at(-1) ?? '');
/** The display a baseline belongs to: its name starts with the display's folder and a mode; else misc. */
const displayOf = (file: string): string | undefined =>
  displays.filter((d) => file.startsWith(`${d}-compact-`) || file.startsWith(`${d}-full-`)).sort((a, b) => b.length - a.length)[0];

describe('screenshot baselines', () => {
  it(`there are at most ${PER_DISPLAY} per registered display plus ${MISC} misc`, () => {
    expect(baselines.length).toBeGreaterThan(0);
    expect(baselines.length).toBeLessThanOrEqual(SCREENSHOT_BUDGET);
  });
  it(`no display has more than ${PER_DISPLAY}`, () => {
    const per = new Map<string, number>();
    for (const f of baselines) {
      const d = displayOf(f);
      if (d !== undefined) per.set(d, (per.get(d) ?? 0) + 1);
    }
    expect([...per].filter(([, n]) => n > PER_DISPLAY)).toEqual([]);
  });
  it(`at most ${MISC} misc baselines`, () => {
    expect(baselines.filter((f) => displayOf(f) === undefined).length).toBeLessThanOrEqual(MISC);
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
