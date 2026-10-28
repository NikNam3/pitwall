// Option validation of normaliseWorkbook (spec 7.2), one declaration per option kind.
import type { Workbook } from '@pitwall/contracts';
import { describe, expect, it } from 'vitest';
import { normaliseWorkbook } from '../../src/shell/workbooks/normalise.ts';

const decl = (options: Record<string, unknown>) => new Map([['w', { name: 'w', title: 'W', data: {}, options, sizes: {} } as never]]);
const book = (options: Record<string, unknown>): Workbook => ({ name: 'b', windows: [{ id: 'main', layout: {}, panels: { p: { widget: 'w', options, linkGroup: 1 } } }] });
const run = (declared: Record<string, unknown>, options: Record<string, unknown>) => {
  const { workbook, notes } = normaliseWorkbook(book(options), decl(declared));
  return { options: workbook.windows[0]!.panels['p']!.options, notes };
};
const invalid = (option: string, value: unknown) => ({ kind: 'invalidOption', windowId: 'main', panelId: 'p', option, value });

describe('bool option', () => {
  const d = { flag: { kind: 'bool', default: false } };
  it('keeps booleans', () => {
    expect(run(d, { flag: true })).toEqual({ options: { flag: true }, notes: [] });
    expect(run(d, { flag: false })).toEqual({ options: { flag: false }, notes: [] });
  });
  it.each([['yes'], [1], [null]])('resets %j to the default with a note', (value) => {
    expect(run(d, { flag: value })).toEqual({ options: { flag: false }, notes: [invalid('flag', value)] });
  });
});

describe('choice option', () => {
  // 5 is deliberately among the choices: a value must be a string to count.
  const d = { mode: { kind: 'choice', choices: ['a', 'b', 5], default: 'a' } };
  it('keeps a listed string', () => {
    expect(run(d, { mode: 'b' }).options).toEqual({ mode: 'b' });
  });
  it.each([['z'], [5], [null]])('resets %j to the default with a note', (value) => {
    expect(run(d, { mode: value })).toEqual({ options: { mode: 'a' }, notes: [invalid('mode', value)] });
  });
});

describe('number option', () => {
  const d = { count: { kind: 'number', range: { min: 1, max: 10, step: 1 }, default: 3 } };
  it.each([[1], [5], [10], [2.5]])('keeps %j (the range includes both ends)', (value) => {
    expect(run(d, { count: value })).toEqual({ options: { count: value }, notes: [] });
  });
  it.each([[0], [11], ['5'], [Number.NaN], [Number.POSITIVE_INFINITY], [null]])('resets %j to the default with a note', (value) => {
    const r = run(d, { count: value });
    expect(r.options).toEqual({ count: 3 });
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ kind: 'invalidOption', option: 'count' });
  });
});

describe('car option', () => {
  const d = { car: { kind: 'car', default: 'player' } };
  it.each([['player'], ['teammate'], [0], [3], [44]])('keeps %j', (value) => {
    expect(run(d, { car: value })).toEqual({ options: { car: value }, notes: [] });
  });
  it.each([['rival'], [-1], [1.5], ['3'], [null], [true]])('resets %j to the default with a note', (value) => {
    expect(run(d, { car: value })).toEqual({ options: { car: 'player' }, notes: [invalid('car', value)] });
  });
});

describe('notes and absent defaults', () => {
  it('an option the widget does not declare is dropped with an unknownOption note', () => {
    expect(run({ flag: { kind: 'bool', default: false } }, { flag: true, extra: 1 })).toEqual({
      options: { flag: true },
      notes: [{ kind: 'unknownOption', windowId: 'main', panelId: 'p', option: 'extra' }],
    });
  });
  it('a missing option with a default gets it, without a note', () => {
    expect(run({ flag: { kind: 'bool', default: true } }, {})).toEqual({ options: { flag: true }, notes: [] });
  });
  it('a missing option without a default (a car following the link) stays absent', () => {
    const { options } = run({ car: { kind: 'car', default: undefined } }, {});
    expect(Object.hasOwn(options, 'car')).toBe(false);
  });
  it('an invalid value of an option without a default is dropped, with a note', () => {
    const r = run({ car: { kind: 'car', default: undefined } }, { car: 'rival' });
    expect(Object.hasOwn(r.options, 'car')).toBe(false);
    expect(r.notes).toEqual([invalid('car', 'rival')]);
  });
});
