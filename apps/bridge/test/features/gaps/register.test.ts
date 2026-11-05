import { GAPS, GAPS_CONFIG, type GapsOutput } from '@pitwall/analysis';
import { carId, type OpenSpan, type GapperLines, type GapToCar, type Interval, type Neighbourhood } from '@pitwall/domain';
import type { IncrementalCalculator } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import type { TopicBinding } from '../../../src/features/feature.ts';
import gaps from '../../../src/features/gaps/register.ts';
import { carState, engineView, field } from '../../../../../test-support/builders/index.ts';

// lights out at 0; 3 cars at 90, 91 and 92 s, 3 full laps: positions 1..3 are cars 0..2, everyone at the line after lap 3
const { crossings: miniSectors } = field({ cars: 3, laps: 3, paceMs: [90_000, 91_000, 92_000] });
const cars = [0, 1, 2].map((i) => carState({ id: carId(i), timing: { lap: 4, lapDistanceM: 0, totalDistanceM: 15_000 } }));
const span = (machine: string, kind: string, over: Partial<OpenSpan> = {}): OpenSpan => ({ machine, id: 0, kind, start: 0, confirmed: true, detail: undefined, startFrame: 0, ...over });
// a race (weekend phase), racing since 0 (the lights out), every car competing
const view = engineView({
  cars,
  history: { crossings: miniSectors },
  situation: {
    weekendPhase: { kind: 'race', format: 'grandPrix' },
    byMachine: {
      'weekend-phase': [span('weekend-phase', 'race', { detail: { format: 'grandPrix' } })],
      'session-phase-race': [span('session-phase-race', 'racing')],
      'car-status': cars.map((c) => span('car-status', 'competing', { carId: c.id })),
    },
  },
});
const calc = gaps.calculators.find((c) => c.id === GAPS) as IncrementalCalculator<unknown, GapsOutput>;
const out = calc.output(calc.init(view), view);

const select = (topic: string, params: object): unknown => {
  const b = gaps.topics.find((t) => t.topic === topic) as Extract<TopicBinding, { from: string }> | undefined;
  if (b === undefined) throw new Error(`no binding for ${topic}`);
  return b.select ? b.select(out, params) : out;
};
const plain = (n: number) => n + 0;
const gapOf = (list: GapToCar[], id: number) => {
  const g = list.find((x) => x.carId === id)!;
  return [g.gapMs.known ? plain(g.gapMs.value) : g.gapMs.reason, g.lapsDown];
};
/** A car's gapper gaps at its line crossings: the points at whole laps (live polish 3.2: `points` replaces `byLap`). */
const line = (lines: GapperLines, id: number) =>
  lines.cars
    .find((c) => c.carId === id)
    ?.points?.filter((p) => p.lap >= 1 && Math.abs(p.lap - Math.round(p.lap)) < 1e-9)
    .map((p) => plain(p.gapMs));
const ref = (lines: GapperLines) => (lines.referenceLapMs.known ? lines.referenceLapMs.value : lines.referenceLapMs.reason);

describe('gaps feature', () => {
  it('registers the gaps calculator, its config and the four topics', () => {
    expect(gaps.name).toBe('gaps');
    expect(gaps.calculators.map((c) => c.id)).toEqual([GAPS]);
    expect(gaps.config).toContain(GAPS_CONFIG);
    expect(gaps.topics.map((t) => t.topic).sort()).toEqual(['gaps.gapper', 'gaps.intervals', 'gaps.neighbourhood', 'gaps.toCar']);
    for (const t of gaps.topics) expect(t).toMatchObject({ from: GAPS });
  });

  it("gaps.intervals and gaps.neighbourhood are the calculator's lists", () => {
    expect(select('gaps.intervals', {}) as Interval[]).toEqual(out.intervals);
    expect(out.intervals).toHaveLength(3);
    expect(select('gaps.neighbourhood', {}) as Neighbourhood[]).toEqual(out.neighbourhood);
    expect(out.neighbourhood).toEqual([{ ourCarId: 0, carIds: [1] }]);
  });

  it("gaps.toCar gives every car's signed gap to params.carId", () => {
    const toCar1 = select('gaps.toCar', { carId: 1 }) as GapToCar[];
    expect(gapOf(toCar1, 0)).toEqual([-3_000, 0]);
    expect(gapOf(toCar1, 2)).toEqual([3_000, 0]);
    const toCar0 = select('gaps.toCar', { carId: 0 }) as GapToCar[];
    expect(gapOf(toCar0, 2)).toEqual([6_000, 0]);
  });

  it.each([[{ carId: 99 }], [{ carId: 7 }], [{}], [{ carId: '1' }], [{ carId: 1.5 }], [{ carId: -1 }]])(
    'gaps.toCar is undefined for %j, which names no car in the race',
    (params) => {
      expect(select('gaps.toCar', params)).toBeUndefined();
    },
  );

  it('gaps.gapper computes the lines to the params reference', () => {
    const leader = select('gaps.gapper', { reference: { kind: 'leaderAverage' } }) as GapperLines;
    expect(ref(leader)).toBe(90_000);
    expect(line(leader, 1)).toEqual([-1_000, -2_000, -3_000]);

    const fixed = select('gaps.gapper', { reference: { kind: 'fixed', lapMs: 89_000 } }) as GapperLines;
    expect(ref(fixed)).toBe(89_000);
    expect(line(fixed, 0)).toEqual([-1_000, -2_000, -3_000]);

    const car1 = select('gaps.gapper', { reference: { kind: 'carAverage', carId: 1 } }) as GapperLines;
    expect(ref(car1)).toBe(91_000);
    expect(line(car1, 2)).toEqual([-1_000, -2_000, -3_000]);
    expect(line(car1, 0)).toEqual([1_000, 2_000, 3_000]);
  });

  it('gaps.gapper holds the window: our car and the cars within 10 s of it, with a point per crossing', () => {
    // car 0 is ours; after 3 laps car 1 is 3 s and car 2 6 s behind it: both in the window
    const lines = select('gaps.gapper', { reference: { kind: 'fixed', lapMs: 90_000 } }) as GapperLines;
    expect(lines.cars.map((c) => c.carId).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    // 3 laps of 50 crossings each after the start line
    expect(lines.cars.find((c) => c.carId === carId(0))?.points?.filter((p) => p.lap > 0)).toHaveLength(150);
  });

  it.each([
    [{}],
    [{ reference: null }],
    [{ reference: { kind: 'fastest' } }],
    [{ reference: { kind: 'carAverage', carId: 99 } }],
    [{ reference: { kind: 'carAverage' } }],
    [{ reference: { kind: 'fixed', lapMs: 0 } }],
    [{ reference: { kind: 'fixed', lapMs: 'fast' } }],
  ])('gaps.gapper is undefined for %j, which names no reference', (params) => {
    expect(select('gaps.gapper', params)).toBeUndefined();
  });
});
