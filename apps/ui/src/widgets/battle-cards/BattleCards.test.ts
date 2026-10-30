// @vitest-environment jsdom
// The battle cards while race control has DRS off: the TO DRS field of each row reads "DRS off", the reason on hover.
import { cleanup, render } from '@testing-library/svelte';
import { carId, known, unknown, type BattleCard, type BattleSide, type Known } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import BattleCards from './BattleCards.svelte';

afterEach(cleanup);

const k = <T>(v: T): Known<T> => known(v, 0);
const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(3, 'Charles Leclerc'), overview(7, 'Alexander Albon')];
const side = (id: number, gapMs: number): BattleSide => ({
  carId: carId(id), gapMs: k(gapMs), closingMsPerLap: k(200), lapsToDrs: unknown('notApplicable'), paceDeltaMs: k(100), overtakeMarginMs: k(-900),
  ours: { compound: 'inter', age: 4 }, theirs: { compound: 'inter', age: 6 }, theirErsStoreJ: k(2_000_000),
});
const card: BattleCard = { carId: carId(1), ahead: k(side(3, 1800)), behind: k(side(7, 2600)), drs: { enabled: false, reason: 'wetTrack' } };

const show = (mode: 'compact' | 'full') =>
  render(InPanel, {
    component: BattleCards as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { card, cars, moment: undefined }, options: {}, size: { mode, cols: 90, rows: 6, px: { width: 900, height: 120 }, dpr: 1 }, link: {} },
    cadenceMs: 50,
  });

/** The fields of the page that read "DRS off". */
const drsOffFields = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll('span')].filter((s) => s.textContent?.trim() === 'DRS off');

describe('BattleCards: DRS off', () => {
  it.each(['full', 'compact'] as const)('%s: both rows read DRS off, each with the reason in its title', (mode) => {
    const fields = drsOffFields(show(mode).container);
    expect(fields.map((f) => f.title)).toEqual(['DRS off: wet track', 'DRS off: wet track']);
  });
});
