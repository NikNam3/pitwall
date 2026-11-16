// `rejoin-ghost` (SP4.3c spec §5.7, O18; live test T13): per our car and condition, where the car was `rejoin`'s stop
// cost ago, on every frame. `rejoin` keeps its order and rejoin position on our crossings and outputs the stop cost its
// position used (`RejoinAt.lossMs`, ruling R41); the ghost reads only `rejoin` (never `pit-loss`: one stop cost, O8,
// C43) and puts the map point at `view.live.sessionTime − lossMs`: our progress interpolated between our two crossings
// around that time, its part within its lap over 50 as the lap fraction, on the track file's outline (C62b). So between
// two crossings the ghost moves on every frame instead of jumping once per crossing. Quick (C31), cadence `frame`, its
// output bound to `rejoinGhost.car` (C42). Built races (`../rejoin/field.ts`); every case runs through the guarded view
// (C41), `rejoin` itself through its own.
import { carId, known, pointAt, unknown, type CarId, type Known, type MapPoint, type PitCondition, type TrackData } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { REJOIN, type RejoinOutput } from '../../src/rejoin/index.ts';
import { rejoinGhostCalculator } from '../../src/rejoin-ghost/calculator.ts';
import { REJOIN_GHOST, type RejoinGhostOutput } from '../../src/rejoin-ghost/index.ts';
import { INSUFFICIENT, NOT_APPLICABLE, NOW, pitLosses, rejoinCase, SEGMENT_MS, US, ZANDVOORT, type RejoinCase } from '../rejoin/field.ts';
import { guardedQuick } from '../situated.ts';

const rejoin = guardedQuick(rejoinCalculator);
const ghost = guardedQuick(rejoinGhostCalculator);

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];

/** Our car's start offset in the standard field: its crossing of progress `n` is at `5 000 + n × SEGMENT_MS`. */
const OUR_OFFSET = 5_000;

/** Our lap fraction at session time `t` in the built race (every car laps at one pace from its offset). */
const fractionAt = (t: number): number => (((t - OUR_OFFSET) / SEGMENT_MS) % 50) / 50;

const OUTLINE = (() => {
  if (!ZANDVOORT.outline.known) throw new Error('the test track has an outline');
  return ZANDVOORT.outline.value;
})();

/** The map point at session time `t` on the test track's outline. */
const pointAtTime = (t: number): MapPoint => pointAt(OUTLINE, fractionAt(t));

/** What a ghost view is built from: the race `rejoin` ran on, the frame's session time, a change of `rejoin`'s output. */
type GhostCase = { race?: RejoinCase; sessionTime?: number; rejoin?: (out: RejoinOutput) => RejoinOutput };

/**
 * The view `rejoin-ghost` sees on a frame: `rejoin`'s output of the race (computed on our newest crossing, `race.now`,
 * default `NOW`), the live state at `sessionTime` (default the race's `now`), and `pit-loss`'s output with other
 * losses (green 30 000) in the outputs as well: the ghost never reads it.
 */
function ghostView(o: GhostCase = {}): EngineView {
  const { view } = rejoinCase(o.race);
  const computed = rejoin.compute(view);
  const out = o.rejoin?.(computed) ?? computed;
  return {
    ...view,
    live: { ...view.live, sessionTime: o.sessionTime ?? o.race?.now ?? NOW },
    outputs: new Map<string, unknown>([
      [REJOIN, out],
      [PIT_LOSS, pitLosses({ green: 30_000, vsc: 30_000, sc: 30_000 })],
    ]),
  };
}

const outputOf = (o: GhostCase = {}): RejoinGhostOutput => ghost.compute(ghostView(o));

/** Car `car`'s map point under `condition`. */
const pointOf = (out: RejoinGhostOutput, condition: PitCondition = 'green', car: number = US): Known<MapPoint> => {
  const g = out.cars[carId(car)];
  if (g === undefined) throw new Error(`no ghost of car ${car}`);
  return g.conditions[condition].mapPoint;
};

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

const near = (got: MapPoint, want: MapPoint, label: string) => {
  expect(got.x, label).toBeCloseTo(want.x, 6);
  expect(got.y, label).toBeCloseTo(want.y, 6);
};

/** `rejoin`'s output with `condition`'s stop cost of every car replaced by `lossMs`. */
const withLoss =
  (condition: PitCondition, lossMs: Known<number>) =>
  (out: RejoinOutput): RejoinOutput => ({
    ...out,
    cars: Object.fromEntries(
      Object.entries(out.cars).map(([id, r]) => [id, { ...r, conditions: { ...r.conditions, [condition]: { ...r.conditions[condition], lossMs } } }]),
    ) as RejoinOutput['cars'],
  });

describe('rejoin-ghost', () => {
  it('is the quick unit `rejoin-ghost` on every frame, reading `rejoin` only (never `pit-loss`)', () => {
    expect(rejoinGhostCalculator.id).toBe(REJOIN_GHOST);
    expect(REJOIN_GHOST).toBe('rejoin-ghost');
    expect(rejoinGhostCalculator.kind).toBe('quick');
    expect(rejoinGhostCalculator.cadence).toBe('frame');
    expect(rejoinGhostCalculator.reads).toEqual([{ calculator: REJOIN }]);
    expect(rejoinGhostCalculator.reads).not.toContainEqual({ calculator: PIT_LOSS });
  });

  it('per our car and condition: where the car was `lossMs` ago, on the outline', () => {
    // our newest crossing: progress 125 at 230 000; 18 000 ms (10 crossings) ago progress 115, 9 000 ago 120, 5 400 ago 122
    const out = outputOf({ race: { losses: { green: 18_000, vsc: 9_000, sc: 5_400 } } });
    const expected: Record<PitCondition, number> = { green: 15 / 50, vsc: 20 / 50, sc: 22 / 50 };
    for (const c of CONDITIONS) near(valueOf(pointOf(out, c)), pointAt(OUTLINE, expected[c]), c);
  });

  it('one value per `rejoin` entry: its car id and the three conditions, each a map point only', () => {
    const out = outputOf({ race: { teammate: 8 } });
    expect(Object.keys(out.cars).map(Number).sort((a, b) => a - b)).toEqual([US, 8]);
    for (const id of [US, 8]) {
      const g = out.cars[carId(id) as CarId];
      expect(g?.carId).toBe(carId(id));
      expect(Object.keys(g?.conditions ?? {}).sort()).toEqual(['green', 'sc', 'vsc']);
      for (const c of CONDITIONS) expect(Object.keys(g?.conditions[c] ?? {}), c).toEqual(['mapPoint']);
    }
    // the teammate (car 8, offset 24 900): 20 300 ms before 230 000, at 209 700, its progress (209 700 − 24 900) / 1 800
    const mate = valueOf(pointOf(out, 'green', 8));
    near(mate, pointAt(OUTLINE, (((209_700 - 24_900) / SEGMENT_MS) % 50) / 50), 'teammate');
  });

  it('no `rejoin` entry, no ghost: a rival, practice and qualifying give none', () => {
    expect(Object.keys(outputOf().cars).map(Number)).toEqual([US]);
    expect(outputOf({ race: { kind: 'practice' } }).cars).toEqual({});
    expect(outputOf({ race: { kind: 'qualifying' } }).cars).toEqual({});
    expect(outputOf({ race: { activity: { [US]: 'boxStop' } } }).cars).toEqual({});
  });

  // T13: the ghost jumped once per ~1.7 s crossing
  it('between two crossings it moves on every frame, forward along the outline, with `rejoin` unchanged', () => {
    const frames = Array.from({ length: 90 }, (_, i) => NOW + i * 20);
    const { view } = rejoinCase();
    const out = rejoin.compute(view);
    const points = frames.map((t) => valueOf(pointOf(outputOf({ sessionTime: t, rejoin: () => out }))));
    frames.forEach((t, i) => near(points[i]!, pointAtTime(t - 20_300), `frame at ${t}`));
    // every frame a new point: no two consecutive frames share one
    for (let i = 1; i < points.length; i++) expect(points[i], `frame ${i}`).not.toEqual(points[i - 1]);
    // forward: the lap fraction it stands for grows frame by frame
    const fractions = frames.map((t) => fractionAt(t - 20_300));
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!);
  });

  it("the stop cost is `rejoin`'s: a double stack's longer cost moves the ghost back by the same amount as the rejoin position used", () => {
    // a double stack: 5 000 ms waiting behind the teammate on top of the green 20 300
    const single = outputOf();
    const stacked = outputOf({ rejoin: withLoss('green', known(25_300, 0)) });
    near(valueOf(pointOf(single)), pointAtTime(NOW - 20_300), 'single');
    near(valueOf(pointOf(stacked)), pointAtTime(NOW - 25_300), 'stacked');
    // `pit-loss`'s 30 000 in the outputs is never the ghost's
    expect(valueOf(pointOf(stacked))).not.toEqual(pointAtTime(NOW - 30_000));
  });

  it("property: every condition's point is at session time − `rejoin`'s lossMs for that condition", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2_000, max: 150_000 }), fc.integer({ min: 0, max: 1_799 }), fc.constantFrom(...CONDITIONS), (loss, x, c) => {
        const out = outputOf({ sessionTime: NOW + x, rejoin: withLoss(c, known(loss, 0)) });
        near(valueOf(pointOf(out, c)), pointAtTime(NOW + x - loss), `${c} ${loss} at +${x}`);
      }),
      { numRuns: 40 },
    );
  });

  it("an unknown stop cost: that condition's map point is the same unknown", () => {
    const out = outputOf({ rejoin: withLoss('vsc', unknown('notReceived')) });
    expect(pointOf(out, 'vsc')).toEqual(unknown('notReceived'));
    expect(pointOf(out, 'green').known).toBe(true);
  });

  it('without a track file, or with one without an outline: `notApplicable`', () => {
    const none = outputOf({ race: { track: unknown('notApplicable') } });
    for (const c of CONDITIONS) expect(pointOf(none, c), c).toEqual(NOT_APPLICABLE);
    const noOutline: TrackData = { ...ZANDVOORT, outline: unknown('notReceived') };
    const bare = outputOf({ race: { track: known(noOutline, 0) } });
    for (const c of CONDITIONS) expect(pointOf(bare, c), c).toEqual(NOT_APPLICABLE);
  });

  it('our crossings begin after session time − loss: `insufficientData`; no crossing of ours: `insufficientData`', () => {
    // first lap: our crossings from 5 000; at 20 000 the green loss of 20 300 reaches back to −300
    const early = outputOf({ race: { now: 20_000 } });
    expect(pointOf(early, 'green')).toEqual(INSUFFICIENT);
    const none = outputOf({ race: { without: [US] } });
    for (const c of CONDITIONS) expect(pointOf(none, c), c).toEqual(INSUFFICIENT);
  });
});
