// @vitest-environment jsdom
// The tower's TO US cell of a retired car (wave 2, T7; supervisor ruling): its gap to us will not come, so the cell shows
// the "will not come" mark, faint, the reason on hover, never an empty cell. `gaps.toCar` gives a car out of the race
// `notApplicable` (the analysis decides the reason, review 2, F6).
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { role } from '../../theme/index.ts';
import { boardRow, interval, lapBoard, overview, sessionInfo, toCar } from './fixtures.ts';
import TimingTower from './TimingTower.svelte';

afterEach(cleanup);

const data = {
  cars: [
    overview(0, { name: 'Max Verstappen', position: 1 }),
    overview(1, { name: 'Kuh Driver', position: 2, ours: true }),
    overview(2, { name: 'Esteban Ocon', position: 3, lap: 22, resultStatus: 'didNotFinish' }),
  ],
  intervals: [interval(0), interval(1, 2184, 2184)],
  toCar: [toCar(0, -2184), toCar(1, undefined), toCar(2, undefined)],
  board: lapBoard(1, [boardRow(0, 104_912), boardRow(1, 104_876), boardRow(2, 'retired')]),
  moment: undefined,
  session: sessionInfo(1),
  incidents: undefined,
};

const show = () =>
  render(InPanel, {
    component: TimingTower as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: { showRetired: true }, size: { mode: 'full', cols: 120, rows: 10, px: { width: 1200, height: 200 }, dpr: 1 }, link: {} },
  }).container;

describe('TimingTower: a retired car', () => {
  it('TO US shows the will-not-come mark, faint, with its reason on hover', () => {
    const cell = show().querySelector<HTMLElement>('[data-row="2"] [data-col="toUs"]');
    expect(cell?.textContent?.trim()).toBe(unknownMark.notApplicable);
    const mark = [...(cell?.querySelectorAll<HTMLElement>('*') ?? [])].find((e) => e.textContent?.trim() === unknownMark.notApplicable && e.children.length === 0);
    expect(mark?.style.color).toBe(role('textFaint'));
    expect(mark?.closest('[title]')?.getAttribute('title')).toBe(unknownReason.notApplicable);
  });

  it('a running car keeps its TO US gap', () => {
    const cell = show().querySelector<HTMLElement>('[data-row="0"] [data-col="toUs"]');
    expect(cell?.textContent?.trim()).not.toBe('');
    expect(cell?.textContent).not.toContain(unknownMark.notApplicable);
  });
});
