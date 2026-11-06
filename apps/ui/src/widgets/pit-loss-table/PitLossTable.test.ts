// @vitest-environment jsdom
// The pit-loss table as it renders (spec 6; mockup docs/design/2026-11-06-sp4.1a/source-badge.html, 32×13 full and 18×3
// compact; C65, C68). Contract assumed of `PitLossTable.svelte` (props `WidgetProps<typeof widget>`):
//  - every text line is an element with class `line`; a blank separator line may be an empty `.line`;
//  - the condition table: columns fitted with `fitColumns(CONDITION_COLUMNS, size.cols, 1)`, one cell gap; a header
//    line (COND LOSS STAT N SOURCE) only in the full mode; the compact mode shows the three condition lines alone;
//  - LOSS: while the SOURCE column is shown (full), the value right-aligned in its 5 cells and no badge mark: the source is
//    in words in SOURCE, whose cell carries the badge's hover; once SOURCE is dropped (compact), the value in 4 cells
//    followed by the kit `SourceBadge` (no mark for a session value, `ᶜ`, `ᵈ`), which carries the hover;
//  - a condition whose source is a default is muted (`conditionRole`), the unknown stationary median the kit's unknown mark;
//  - full only: a blank line, the title `text.stopsTitle`, the stop header (LAP DRV COND LOSS STAT) and the newest stops
//    that fit the rows left; a stop that does not count is faint (`stopRole`) and its line carries the hover
//    `text.unused[use]`; our cars' codes take the kit own-car role.
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { fitCell } from '../../kit/grid/grid.ts';
import { sourceHover, unknownMark } from '../../kit/text.ts';
import { role } from '../../theme/index.ts';
import { calibrationSource, defaultSource, sessionSource } from './fixtures.ts';
import gallery from './gallery.ts';
import PitLossTable from './PitLossTable.svelte';
import * as text from './text.ts';
import { widget } from './widget.ts';

afterEach(cleanup);

type CaseName = keyof NonNullable<typeof gallery.cases>;
const SIZES = { compact: { cols: 18, rows: 3 }, full: { cols: 32, rows: 13 } } as const;

function show(name: CaseName, mode: keyof typeof SIZES | { mode: string; cols: number; rows: number }): HTMLElement {
  const size = typeof mode === 'string' ? { mode, ...SIZES[mode] } : mode;
  return render(InPanel, {
    component: PitLossTable as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data: gallery.cases?.[name],
      options: {},
      size: { ...size, px: { width: size.cols * 8, height: size.rows * 16 }, dpr: 1 },
      link: {},
    },
  }).container;
}

/** Every `.line` element. */
const lineElements = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.line')];
/** The non-blank lines as they read, trimmed. */
const lines = (c: HTMLElement): string[] => lineElements(c).map((e) => (e.textContent ?? '').trim()).filter((t) => t !== '');
/** The line that starts with `prefix` (after its lead). */
const lineStarting = (c: HTMLElement, prefix: string): HTMLElement | undefined => lineElements(c).find((e) => (e.textContent ?? '').trim().startsWith(prefix));
/** The innermost element of `scope` whose own text, trimmed, is `t`. */
const cellWithText = (scope: HTMLElement, t: string): HTMLElement | undefined =>
  [...scope.querySelectorAll<HTMLElement>('*')].reverse().find((e) => (e.textContent ?? '').trim() === t);
/** The colour an element shows: its own inline colour or the nearest ancestor's, up to the widget. */
function colourOf(el: HTMLElement | undefined, stop: HTMLElement): string {
  for (let e: HTMLElement | null = el ?? null; e !== null && e !== stop.parentElement; e = e.parentElement) {
    if (e.style.color !== '') return e.style.color;
  }
  return '';
}
/** The hover texts on `line` and inside it. */
const hovers = (line: HTMLElement): string[] => [line, ...line.querySelectorAll<HTMLElement>('[title]')].map((e) => e.getAttribute('title') ?? '').filter((t) => t !== '');

const hoverOf = {
  session: sourceHover.session(sessionSource(6).parts),
  calibration: sourceHover.calibration('league', 4, calibrationSource().parts),
  default: sourceHover.default((defaultSource as { note: string }).note),
};
const pendingStat = fitCell(unknownMark.insufficientData, 4, 'right');

describe('the pit-loss table at its gallery cases', () => {
  it('the gallery has the cases the task names: measured (first), calibration, defaults only, a noReference and a penalty stop', () => {
    expect(Object.keys(gallery.cases ?? {})).toEqual(expect.arrayContaining(['measured', 'calibration', 'defaultsOnly', 'noReferenceStop', 'penaltyStop']));
    expect(Object.keys(gallery.cases ?? {})[0]).toBe('measured');
  });

  it('the gallery fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(gallery.fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });

  it('every case at every fit size keeps each line within its columns and the lines within its rows', () => {
    for (const name of Object.keys(gallery.cases ?? {}) as CaseName[]) {
      for (const size of gallery.fit ?? []) {
        const c = show(name, size);
        const all = lineElements(c).map((e) => e.textContent ?? '');
        expect(all.length, `${name} at ${size.mode} ${size.cols}x${size.rows}`).toBeLessThanOrEqual(size.rows);
        for (const l of all) expect(l.length, `${name} at ${size.cols}x${size.rows}: "${l}"`).toBeLessThanOrEqual(size.cols);
        cleanup();
      }
    }
  });
});

describe('full (32×13): the mockup', () => {
  it('shows the conditions with STAT, N and SOURCE in words, then this session\'s stops newest first', () => {
    expect(lines(show('measured', 'full'))).toEqual([
      'COND   LOSS STAT  N SOURCE',
      'green  20.3  2.4  6 session',
      'VSC    13.4  2.5  0 calibration',
      `SC      9.8 ${pendingStat}  0 default`,
      text.stopsTitle,
      'LAP DRV COND   LOSS STAT',
      'L19 BOR green  20.6  2.5',
      'L18 ANT green  20.1  2.3',
      'L16 BEA green  20.4  2.4',
      'L15 LIN green  20.0  2.3',
      'L14 LAW green  20.9  2.6',
      'L12 DOO green  19.8  2.4',
    ]);
  });

  it('shows no badge mark while the source is in words', () => {
    for (const l of lines(show('measured', 'full')).slice(1, 4)) expect(l).not.toMatch(/[ᶜᵈ]/u);
  });

  it('gives each SOURCE word the badge\'s hover', () => {
    const c = show('measured', 'full');
    for (const kind of ['session', 'calibration', 'default'] as const) {
      expect(cellWithText(c, kind)?.closest('[title]')?.getAttribute('title'), kind).toBe(hoverOf[kind]);
    }
  });

  it('mutes the default condition and leaves the others in the text colour', () => {
    const c = show('measured', 'full');
    expect(colourOf(cellWithText(lineStarting(c, 'SC')!, 'default'), c)).toBe(role('textDim'));
    expect(colourOf(cellWithText(lineStarting(c, 'VSC')!, 'calibration'), c)).toBe('');
    expect(colourOf(cellWithText(lineStarting(c, 'green')!, 'session'), c)).toBe('');
  });

  it('mutes every condition when every loss is a default', () => {
    const c = show('defaultsOnly', 'full');
    for (const cond of ['green', 'VSC', 'SC']) expect(colourOf(cellWithText(lineStarting(c, cond)!, cond), c), cond).toBe(role('textDim'));
  });

  it('shows our cars\' codes in the own-car colour', () => {
    const c = show('measured', 'full');
    expect(colourOf(cellWithText(lineStarting(c, 'L15')!, 'LIN'), c)).toBe(role('ownCar'));
    expect(colourOf(cellWithText(lineStarting(c, 'L19')!, 'BOR'), c)).toBe('');
  });

  it('shows the six newest stops that fit: a seventh, older one is left out', () => {
    const shown = lines(show('noReferenceStop', 'full')).filter((l) => /^L\d\d /.test(l)).map((l) => l.slice(0, 3));
    expect(shown).toEqual(['L21', 'L19', 'L18', 'L16', 'L15', 'L14']);
  });

  it('shows a stop without clean reference laps faint, its loss the unknown mark, with why on hover', () => {
    const c = show('noReferenceStop', 'full');
    const line = lineStarting(c, 'L21')!;
    expect((line.textContent ?? '').trim()).toBe(`L21 HAD green ${fitCell(unknownMark.insufficientData, 5, 'right')}  2.4`);
    expect(colourOf(cellWithText(line, 'HAD'), c)).toBe(role('textFaint'));
    expect(hovers(line)).toContain(text.unused.noReference);
  });

  it('shows a stop that served a penalty faint with its loss, with why on hover (R12)', () => {
    const c = show('penaltyStop', 'full');
    const line = lineStarting(c, 'L22')!;
    expect((line.textContent ?? '').trim()).toBe('L22 KUH green  25.7  7.5');
    expect(colourOf(cellWithText(line, '25.7'), c)).toBe(role('textFaint'));
    expect(hovers(line)).toContain(text.unused.penalty);
  });

  it('carries no unused hover on a counted stop', () => {
    const line = lineStarting(show('penaltyStop', 'full'), 'L19')!;
    expect(hovers(line)).not.toContain(text.unused.penalty);
    expect(hovers(line)).not.toContain(text.unused.noReference);
  });

  it('names each stop\'s condition', () => {
    const c = show('neutralisedStops', 'full');
    expect((lineStarting(c, 'L30')?.textContent ?? '').trim()).toBe('L30 ANT VSC    13.1  2.4');
    expect(lines(c).filter((l) => l.startsWith('L31')).map((l) => l.slice(8, 13).trim())).toEqual(['SC', 'SC']);
  });
});

describe('compact (18×3)', () => {
  it('shows the three losses with their badges and nothing else', () => {
    expect(lines(show('measured', 'compact'))).toEqual(['green 20.3', 'VSC   13.4ᶜ', 'SC     9.8ᵈ']);
  });

  it('puts the badge\'s hover on each loss', () => {
    const c = show('measured', 'compact');
    for (const [prefix, kind] of [['green', 'session'], ['VSC', 'calibration'], ['SC', 'default']] as const) {
      expect(hovers(lineStarting(c, prefix)!), prefix).toContain(hoverOf[kind]);
    }
  });

  it('marks every loss ᶜ on the calibration', () => {
    expect(lines(show('calibration', 'compact'))).toEqual(['green 20.4ᶜ', 'VSC   13.4ᶜ', 'SC     9.8ᵈ']);
  });

  it('marks every loss ᵈ without a calibration', () => {
    expect(lines(show('defaultsOnly', 'compact'))).toEqual(['green 21.0ᵈ', 'VSC   13.0ᵈ', 'SC     9.8ᵈ']);
  });

  it('shows no stop', () => {
    expect(lines(show('penaltyStop', 'compact')).some((l) => l.startsWith('L'))).toBe(false);
  });
});
