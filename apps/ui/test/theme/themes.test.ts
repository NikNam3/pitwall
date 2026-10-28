import { describe, expect, it } from 'vitest';
import { THEMES, applyTheme, role } from '../../src/theme/index.ts';
import type { Role } from '../../src/theme/roles.ts';
import { lightness, parseOklch } from './colour.ts';

const ROLES: Role[] = [
  'text', 'textDim', 'textFaint', 'ownCar', 'bg', 'bgPanel', 'bgBand', 'bgRowBand', 'border', 'grid',
  'critical', 'warning', 'best', 'personalBest', 'flagYellow', 'flagGreen', 'flagRed', 'flagBlue',
  'series1', 'series2', 'series3', 'series4', 'series5', 'series6',
];
const SERIES: Role[] = ['series1', 'series2', 'series3', 'series4', 'series5', 'series6'];

const byName = (n: string) => THEMES.find((t) => t.name === n)!;

describe('THEMES', () => {
  it('has quiet, quiet-roomy and at least one open-colour-question variant, with unique names', () => {
    const names = THEMES.map((t) => t.name);
    expect(names).toContain('quiet');
    expect(names).toContain('quiet-roomy');
    expect(THEMES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every variant defines every role as a non-empty string', () => {
    for (const t of THEMES) {
      for (const r of ROLES) expect(t.roles[r], `${t.name}.${r}`).toMatch(/\S/);
    }
  });

  it('quiet carries the approved anchor values verbatim', () => {
    const q = byName('quiet').roles;
    expect(q.bg).toBe('#000000');
    expect(q.bgPanel).toBe('#000000');
    expect(q.text).toBe('#d9dbe0');
    expect(q.critical).toBe('#ff5c5c');
    expect(q.warning).toBe('#f0b429');
    expect(q.best).toBe('#b06cff');
    expect(q.personalBest).toBe('#3fcf70');
    expect(q.ownCar).toBe('#ffffff');
    expect(q.series1).toBe('oklch(0.72 0.09 250)');
  });

  it('quiet uses fontPx 14 and the Task 0 density; quiet-roomy the roomier one', () => {
    const q = byName('quiet');
    expect(q.fontPx).toBe(14);
    expect(q.density).toEqual({ lineHeight: 1.4, panelGapPx: 8, columnGapCols: 1, headerPadCols: 1 });
    expect(byName('quiet-roomy').density).toEqual({ lineHeight: 1.6, panelGapPx: 12, columnGapCols: 2, headerPadCols: 1 });
  });

  it('series roles of every variant are distinct and none equals critical, warning or best', () => {
    for (const t of THEMES) {
      const values = SERIES.map((r) => t.roles[r]);
      expect(new Set(values).size, t.name).toBe(6);
      for (const v of values) {
        expect(v).not.toBe(t.roles.critical);
        expect(v).not.toBe(t.roles.warning);
        expect(v).not.toBe(t.roles.best);
      }
    }
  });

  it('series roles of every variant have OKLCH lightness within 0.05 of each other', () => {
    for (const t of THEMES) {
      const ls = SERIES.map((r) => lightness(t.roles[r]));
      expect(Math.max(...ls) - Math.min(...ls), t.name).toBeLessThanOrEqual(0.05);
    }
  });

  it('quiet series hues are the approved 250, 40, 150, 310, 95, 200', () => {
    const hues = SERIES.map((r) => parseOklch(byName('quiet').roles[r])?.h);
    expect(hues).toEqual([250, 40, 150, 310, 95, 200]);
  });
});

describe('role()', () => {
  it('returns the CSS variable reference', () => {
    expect(role('text')).toBe('var(--pw-text)');
    expect(role('personalBest')).toBe('var(--pw-personalBest)');
    expect(role('series3')).toBe('var(--pw-series3)');
  });
});

describe('applyTheme()', () => {
  function fakeRoot() {
    const props = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => void props.set(k, v) } } as unknown as HTMLElement;
    return { root, props };
  }

  it('sets one --pw-<role> variable per role with the variant value', () => {
    const { root, props } = fakeRoot();
    const q = byName('quiet');
    applyTheme(q, root);
    for (const r of ROLES) expect(props.get(`--pw-${r}`), r).toBe(q.roles[r]);
  });

  it('sets font and density variables', () => {
    const { root, props } = fakeRoot();
    applyTheme(byName('quiet'), root);
    expect(props.get('--pw-font')).toContain('JetBrains Mono');
    expect(parseFloat(props.get('--pw-font-px')!)).toBe(14);
    expect(parseFloat(props.get('--pw-line')!)).toBe(1.4);
    expect(parseFloat(props.get('--pw-panel-gap')!)).toBe(8);
    expect(parseFloat(props.get('--pw-col-gap')!)).toBe(1);
    expect(parseFloat(props.get('--pw-header-pad')!)).toBe(1);
  });

  it('switching variant overwrites the density variables', () => {
    const { root, props } = fakeRoot();
    applyTheme(byName('quiet'), root);
    applyTheme(byName('quiet-roomy'), root);
    expect(parseFloat(props.get('--pw-line')!)).toBe(1.6);
    expect(parseFloat(props.get('--pw-panel-gap')!)).toBe(12);
    expect(parseFloat(props.get('--pw-col-gap')!)).toBe(2);
  });
});
