// normaliseWorkbook (Task 15, spec 7.2 "read leniently"). Contract assumed of the result:
//  - `notes` has one entry per problem; the note of an unknown widget has `kind: 'unknownWidget'`;
//    every note mentions its panel id (and, for options, the option name) somewhere in its JSON.
//  - the input is never mutated.
import type { Workbook } from '@pitwall/contracts';
import { describe, expect, it } from 'vitest';
import { normaliseWorkbook } from '../../src/shell/workbooks/normalise.ts';
import { TEST_WIDGET_MAP } from './fixtures/index.ts';

const DEFAULTS = { mode: 'a', count: 3, flag: false };
const workbook = (panels: Record<string, { widget: string; options: Record<string, unknown>; linkGroup: number }>): Workbook => ({
  name: 'race',
  windows: [{ id: 'main', layout: { grid: 1 }, panels, fontPx: 16, geometry: { screen: 0, x: 1, y: 2, width: 3, height: 4 } }],
});
const panelsOf = (w: Workbook) => w.windows[0]!.panels;
const text = (notes: unknown[]) => JSON.stringify(notes);

describe('normaliseWorkbook', () => {
  it('a valid workbook comes back unchanged with no notes', () => {
    const input = workbook({ p1: { widget: 'probe', options: { mode: 'b', count: 5, flag: true }, linkGroup: 2 } });
    const { workbook: out, notes } = normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(out).toEqual(input);
    expect(notes).toEqual([]);
  });

  it('keeps an unknown widget panel unchanged and notes it as unknownWidget', () => {
    const input = workbook({ p1: { widget: 'ghost', options: { whatever: [1, 2] }, linkGroup: 3 } });
    const { workbook: out, notes } = normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(panelsOf(out).p1).toEqual({ widget: 'ghost', options: { whatever: [1, 2] }, linkGroup: 3 });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'unknownWidget' });
    expect(text(notes)).toContain('p1');
  });

  it('drops an option of the wrong type, falls back to the default and notes it', () => {
    const input = workbook({ p1: { widget: 'probe', options: { mode: 'b', count: 'five', flag: true }, linkGroup: 1 } });
    const { workbook: out, notes } = normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(panelsOf(out).p1!.options).toEqual({ mode: 'b', count: 3, flag: true });
    expect(notes).toHaveLength(1);
    expect(text(notes)).toContain('count');
    expect(text(notes)).toContain('p1');
  });

  it('a choice outside its choices, and a number outside its range, count as wrong', () => {
    const input = workbook({ p1: { widget: 'probe', options: { mode: 'zzz', count: 99, flag: false }, linkGroup: 1 } });
    const { workbook: out, notes } = normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(panelsOf(out).p1!.options).toEqual(DEFAULTS);
    expect(notes).toHaveLength(2);
  });

  it('drops an unknown option and notes it', () => {
    const input = workbook({ p1: { widget: 'probe', options: { ...DEFAULTS, colour: 'red' }, linkGroup: 1 } });
    const { workbook: out, notes } = normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(panelsOf(out).p1!.options).toEqual(DEFAULTS);
    expect(notes).toHaveLength(1);
    expect(text(notes)).toContain('colour');
  });

  it('fills a missing option with its default, without a note', () => {
    const input = workbook({ p1: { widget: 'probe', options: { mode: 'b' }, linkGroup: 1 } });
    const { workbook: out, notes } = normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(panelsOf(out).p1!.options).toEqual({ mode: 'b', count: 3, flag: false });
    expect(notes).toEqual([]);
  });

  it('keeps everything else of the workbook: layout, geometry, fontPx, link group, other windows', () => {
    const input = workbook({ p1: { widget: 'probe', options: {}, linkGroup: 4 } });
    input.windows.push({ id: 'second', layout: 'other', panels: {} });
    const { workbook: out } = normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(out.name).toBe('race');
    expect(out.windows[0]).toMatchObject({ id: 'main', layout: { grid: 1 }, fontPx: 16, geometry: { screen: 0, x: 1, y: 2, width: 3, height: 4 } });
    expect(out.windows[0]!.panels.p1!.linkGroup).toBe(4);
    expect(out.windows[1]).toEqual({ id: 'second', layout: 'other', panels: {} });
  });

  it('does not mutate its input', () => {
    const input = workbook({ p1: { widget: 'probe', options: { count: 'x', extra: 1 }, linkGroup: 1 } });
    const before = structuredClone(input);
    normaliseWorkbook(input, TEST_WIDGET_MAP);
    expect(input).toEqual(before);
  });
});
