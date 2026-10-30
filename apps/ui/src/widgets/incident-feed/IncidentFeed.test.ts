// @vitest-environment jsdom
// The incident feed's marks (wave 2, T7; review-ui finding 8): in the for-us cell each unknown part shows its reason's
// mark where the value goes, not at the end of the line; a car list cut to its column never ends its known part in the
// cut marker before a mark (the cut marker and the pending mark are the same glyph).
import { cleanup, render } from '@testing-library/svelte';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, IncidentForUs, Known, UnknownReason } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { role } from '../../theme/index.ts';
import IncidentFeed from './IncidentFeed.svelte';
import { COLUMN_GAP, LEAD, widths } from './rows.ts';

afterEach(cleanup);

const k = <T>(v: T): Known<T> => known(v, 0);
const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(2, 'Esteban Ocon'), overview(3, 'Carlos Sainz'), overview(4, 'Alexander Albon')];

const forUs = (over: Partial<IncidentForUs> = {}): IncidentForUs => ({
  ourCarId: carId(1), otherCarId: k(carId(2)), positionBefore: k(5), positionAfter: k(4), gapBeforeMs: k(4100), gapAfterMs: unknown('notApplicable'), ...over,
});
const entry = (over: Partial<IncidentEntry> = {}): IncidentEntry => ({
  id: 'e', at: toSessionTime(230_000), lap: 23, kind: 'collision', severity: 'major', carIds: [carId(2), carId(3)],
  timeLostMs: k(4200), forUs: [forUs()], where: { sector: unknown('notReceived') }, ...over,
});

const show = (feed: IncidentEntry[], overview: CarOverview[] = cars) =>
  render(InPanel, {
    component: IncidentFeed as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { feed, cars: overview, moment: undefined }, options: {}, size: { mode: 'full', cols: 90, rows: 5, px: { width: 900, height: 100 }, dpr: 1 }, link: {} },
  }).container;

/** The row's line as it reads. */
const line = (c: HTMLElement): string => c.querySelector('[data-testid="incident-e"]')?.textContent ?? '';

/** The faint marks of a reason in the row, each hovered with the reason. */
const marks = (c: HTMLElement, reason: UnknownReason): HTMLElement[] =>
  [...(c.querySelector('[data-testid="incident-e"]')?.querySelectorAll<HTMLElement>('*') ?? [])].filter(
    (e) =>
      e.textContent?.trim() === unknownMark[reason] && e.style.color === role('textFaint') && ![...e.children].some((x) => x.textContent?.trim() === unknownMark[reason]) &&
      e.closest('[title]')?.getAttribute('title') === unknownReason[reason],
  );

/** The for-us cell's text: the line from the for-us column on, trimmed. */
const forUsText = (c: HTMLElement): string => line(c).slice(LEAD + widths.lap + widths.cars + widths.what + widths.lost + 4 * COLUMN_GAP).trimEnd();

describe('IncidentFeed: the for-us cell places each mark at its unknown part', () => {
  it('an unknown position before: the mark where the position goes', () => {
    const c = show([entry({ forUs: [forUs({ positionBefore: unknown('notReceived') })] })]);
    expect(forUsText(c)).toBe(`us ${unknownMark.notReceived}, OCO +4.1→DNF`);
    expect(marks(c, 'notReceived')).toHaveLength(1);
  });

  it('an unknown gap after: the mark after the arrow', () => {
    const c = show([entry({ forUs: [forUs({ gapAfterMs: unknown('notReceived') })] })]);
    expect(forUsText(c)).toBe(`us P5→P4, OCO +4.1→${unknownMark.notReceived}`);
  });

  it('an unknown gap before: the mark before the arrow', () => {
    const c = show([entry({ forUs: [forUs({ gapBeforeMs: unknown('insufficientData'), gapAfterMs: k(5800) })] })]);
    expect(forUsText(c)).toBe(`us P5→P4, OCO ${unknownMark.insufficientData}→+5.8`);
    expect(marks(c, 'insufficientData')).toHaveLength(1);
  });

  it('the other car missing from cars.overview: the mark where its code goes', () => {
    const c = show([entry({ carIds: [carId(2)], forUs: [forUs({ otherCarId: k(carId(9)) })] })]);
    expect(forUsText(c)).toBe(`us P5→P4, ${unknownMark.notReceived} +4.1→DNF`);
  });

  it('two unknown parts: two marks, each in its place', () => {
    const c = show([entry({ forUs: [forUs({ positionBefore: unknown('notReceived'), gapAfterMs: unknown('notReceived') })] })]);
    expect(forUsText(c)).toBe(`us ${unknownMark.notReceived}, OCO +4.1→${unknownMark.notReceived}`);
    expect(marks(c, 'notReceived')).toHaveLength(2);
  });

  it('a known for-us cell has no mark', () => {
    const c = show([entry()]);
    expect(forUsText(c)).toBe('us P5→P4, OCO +4.1→DNF');
    expect(marks(c, 'notApplicable')).toEqual([]);
  });
});

describe('IncidentFeed: a cut car list before its mark', () => {
  // OCO and SAI fill the cars column (7 characters) alone; with a car the field lacks, the known part is cut for the mark.
  const cut = () => show([entry({ carIds: [carId(2), carId(3), carId(9)] })]);
  const carsCell = (c: HTMLElement): string => line(c).slice(LEAD + widths.lap + COLUMN_GAP, LEAD + widths.lap + COLUMN_GAP + widths.cars);

  it('keeps the column width and ends in the mark, hovered with its reason', () => {
    const c = cut();
    expect(carsCell(c)).toHaveLength(widths.cars);
    expect(carsCell(c).trimEnd().endsWith(unknownMark.notReceived)).toBe(true);
    expect(marks(c, 'notReceived')).toHaveLength(1);
  });

  it('the known part before the mark is a cut of the codes that does not end in the cut marker', () => {
    const before = carsCell(cut()).trimEnd().slice(0, -unknownMark.notReceived.length).trimEnd();
    expect('OCO SAI'.startsWith(before)).toBe(true);
    expect(before.endsWith('…')).toBe(false);
    expect(before).not.toBe('');
  });
});
