// The calibration-panel declaration (spec 6, plan Task 15): what it reads, its sizes from the mockup
// (docs/design/2026-11-06-sp4.1a/README.md: compact 36×7, full 76×29 with no source open) and the uiActions it sends
// (C74): every `calibration.*` kind but `calibration.choose`, which is the shell's prompt (Task 16).
import type { UiAction } from '@pitwall/contracts';
import { describe, expect, it } from 'vitest';
import { cases, fit } from './fixtures.ts';
import { widget } from './widget.ts';

const PANEL_ACTIONS: UiAction['kind'][] = [
  'calibration.set.create', 'calibration.set.copy', 'calibration.set.rename', 'calibration.set.delete',
  'calibration.source.add', 'calibration.source.remove', 'calibration.lap.exclude', 'calibration.lap.include',
  'calibration.override.set', 'calibration.override.clear',
];

describe('calibration-panel declaration', () => {
  it('is named calibration-panel and titled "Calibration"', () => {
    expect([widget.name, widget.title]).toEqual(['calibration-panel', 'Calibration']);
  });

  it('reads calibration.sets, .values, .candidates and .active', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([name, d]) => [name, d.topic]))).toEqual({
      sets: 'calibration.sets',
      values: 'calibration.values',
      candidates: 'calibration.candidates',
      active: 'calibration.active',
    });
  });

  it('has the mockup sizes: compact 36×7, full 76×29', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 36, minRows: 7 }, full: { minCols: 76, minRows: 29 } });
  });

  it('declares exactly the calibration.* actions but calibration.choose', () => {
    expect([...widget.actions].sort()).toEqual([...PANEL_ACTIONS].sort());
    expect(widget.actions).not.toContain('calibration.choose');
  });
});

describe('calibration-panel gallery', () => {
  it('starts with the mockup\'s main figure and has its other figures as cases', () => {
    expect(Object.keys(cases)[0]).toBe('activeLeague');
    expect(Object.keys(cases)).toEqual(expect.arrayContaining(['noSession', 'staleSource', 'defaultsChosen', 'noSet']));
  });

  it('fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });
});
