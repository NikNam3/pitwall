// SP4.3c Task 6 (spec §5.3 O10; contract C3, C26, C31, C43; live test T12): `gaps` owns the gaps and the order now and
// the leader's progress (`leaderProgress`), and the gapper starts at lights out when the engine saw it, else at the
// leader's first line crossing after the join (`origin: { kind: 'join', lap }`), so a race joined after lights out
// draws its lines (the gapper's and `rejoin`'s ghost lines). `lap` of the origin is on the gapper's x: the leader's
// completed laps at that crossing.
import { carId, known, MINI_SECTORS, unknown, type GapperLines, type GapperReference, type MiniSectorCrossing, type OpenSpan, type PitCondition, type Known, type Ms } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crossings } from '../../../../test-support/builders/index.ts';
import { gapperLines } from '../../src/shared/gapper-lines.ts';
import { ghostLinesOf } from '../../src/rejoin/ghost-lines.ts';
import { REJOIN_CONFIG } from '../../src/rejoin/index.ts';
import { byTime, deltaOf, gaps, guarded, plain, progressAtX, progressOf, run, viewOf } from './race.ts';

const LEADER: GapperReference = { kind: 'leaderAverage' };
const FIXED: GapperReference = { kind: 'fixed', lapMs: 90_000 };

/**
 * `view` as a race the engine joined at `joinAt` while it was already `racing`: the race session phase has no closed
 * span and one open `racing` span with `joinedAt` (C14, C20), so lights out was not seen (C3).
 */
function joined(view: EngineView, joinAt: number): EngineView {
  const racing: OpenSpan = { machine: 'session-phase-race', id: 0, kind: 'racing', start: joinAt, confirmed: true, detail: undefined, startFrame: joinAt, joinedAt: true };
  return {
    ...view,
    history: { ...view.history, spans: { ...view.history.spans, 'session-phase-race': [] } },
    situation: { ...view.situation, byMachine: { ...view.situation.byMachine, 'session-phase-race': [racing] } },
  };
}

/** Every car laps at 90 s, car i starting `offsets[i]` after 0, for `laps` laps, closing the last at `(laps + 1, 0)`. */
function race(offsets: readonly number[], laps: number): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  offsets.forEach((offset, i) => {
    for (let n = 1; n <= laps; n++) list.push(...crossings(carId(i), n, 90_000, offset + (n - 1) * 90_000));
    list.push({ carId: carId(i), lap: laps + 1, segment: 0, at: offset + laps * 90_000, frame: 0 });
  });
  return byTime(list);
}

/** The crossings a run that joined at `joinAt` holds: those after it. */
const after = (list: readonly MiniSectorCrossing[], joinAt: number) => list.filter((m) => m.at > joinAt);

/** Three cars 1 s and 2.5 s apart over 6 laps; the engine joins at 130 s, the leader (car 0) in lap 2 (progress 72). */
const OFFSETS = [0, 1_000, 2_500];
const FULL = race(OFFSETS, 6);
const JOIN_AT = 130_000;
/** The leader's first line crossing after the join: (3, 0) at 180 s, having completed 2 laps. */
const ORIGIN_LAP = 2;
const joinedView = (list: readonly MiniSectorCrossing[] = FULL, o: Parameters<typeof viewOf>[1] = {}) => joined(viewOf(after(list, JOIN_AT), { teammateCar: 2, ...o }), JOIN_AT);

/** A car's points as `[progress, gapMs]`. */
const pointsOf = (lines: GapperLines, car: number) => lines.cars.find((c) => c.carId === car)?.points.map((p): [number, number] => [progressAtX(p.lap), plain(p.gapMs)]) ?? [];

describe('gaps: the gapper origin (row 1: a lights-out race is unchanged)', () => {
  it('a race whose lights out was seen starts at lights out', () => {
    const out = run(viewOf(FULL));
    expect(gapperLines(out, LEADER).origin).toMatchObject({ known: true, value: { kind: 'lightsOut' } });
    expect(gapperLines(out, FIXED).origin).toMatchObject({ known: true, value: { kind: 'lightsOut' } });
    // a race joined in the formation that then sees the lights go out is a lights-out race too (C3, the race start rows)
    expect(out.raceStartAt).toMatchObject({ known: true, value: 0 });
  });

  it('outside a race the origin is notApplicable; before lights out it is notReceived', () => {
    expect(gapperLines(run(viewOf(FULL, { kind: 'practice', lightsOutAt: null })), LEADER).origin).toEqual(unknown('notApplicable'));
    expect(gapperLines(run(viewOf([], { lightsOutAt: null })), LEADER).origin).toEqual(unknown('notReceived'));
  });
});

describe('gaps: a race joined after lights out (row 2)', () => {
  it("starts at the leader's first line crossing after the join: origin { kind: 'join', lap }", () => {
    const lines = gapperLines(run(joinedView()), FIXED);
    expect(lines.origin).toMatchObject({ known: true, value: { kind: 'join', lap: ORIGIN_LAP } });
  });

  it('every car has points from the origin on, none before it', () => {
    const lines = gapperLines(run(joinedView()), FIXED);
    for (const car of [0, 1, 2]) {
      const points = pointsOf(lines, car);
      expect(points.length, `car ${car}`).toBeGreaterThan(0);
      // none before the origin; the first within the lap after it
      expect(Math.min(...points.map(([p]) => p)), `car ${car}`).toBeGreaterThanOrEqual(ORIGIN_LAP * MINI_SECTORS);
      expect(Math.min(...points.map(([p]) => p)), `car ${car}`).toBeLessThanOrEqual((ORIGIN_LAP + 1) * MINI_SECTORS);
    }
  });

  it("the gap between two cars at a point is the from-the-start run's", () => {
    const fromStart = gapperLines(run(viewOf(FULL, { teammateCar: 2 })), FIXED);
    const join = gapperLines(run(joinedView()), FIXED);
    const at = (lines: GapperLines, car: number) => new Map(pointsOf(lines, car));
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]] as const) {
      const ja = at(join, a);
      const jb = at(join, b);
      const sa = at(fromStart, a);
      const sb = at(fromStart, b);
      const common = [...ja.keys()].filter((p) => jb.has(p));
      expect(common.length, `${a}-${b}`).toBeGreaterThan(0);
      for (const p of common) expect(plain(ja.get(p)! - jb.get(p)!), `${a}-${b} at ${p}`).toBe(plain(sa.get(p)! - sb.get(p)!));
    }
  });

  it("before the leader's first line crossing after the join the origin is notReceived and no car has a line", () => {
    const early = joinedView(FULL.filter((m) => m.at < 175_000));
    const lines = gapperLines(run(early), FIXED);
    expect(lines.origin).toEqual(unknown('notReceived'));
    for (const car of lines.cars) expect(car.points, `car ${car.carId}`).toEqual([]);
  });

  it('a joined race under a safety car, then racing: the origin is a join too, never lights out (C3)', () => {
    const base = viewOf(after(FULL, JOIN_AT), { teammateCar: 2 });
    const sc = { machine: 'session-phase-race', id: 0, kind: 'neutralised', start: JOIN_AT, end: 175_000, confirmed: true, detail: { car: 'SC', stages: [] }, startFrame: JOIN_AT, endFrame: 175_000, joinedAt: true as const };
    const racing: OpenSpan = { machine: 'session-phase-race', id: 1, kind: 'racing', start: 175_000, confirmed: true, detail: undefined, startFrame: 175_000 };
    const view: EngineView = {
      ...base,
      history: { ...base.history, spans: { ...base.history.spans, 'session-phase-race': [sc] } },
      situation: { ...base.situation, byMachine: { ...base.situation.byMachine, 'session-phase-race': [racing] } },
    };
    const origin = gapperLines(run(view), FIXED).origin;
    expect(origin.known && origin.value.kind).toBe('join');
  });

  it('update over deltas equals init over the whole history; a flashback equals a fresh run (C31)', () => {
    const early = joinedView(FULL.filter((m) => m.at < 175_000));
    const full = joinedView();
    const stepped = gaps.output(gaps.update(gaps.init(guarded(early)), deltaOf(early, full), guarded(full)));
    expect(stepped).toEqual(run(full));
    const back = gaps.output(gaps.update(gaps.init(guarded(full)), deltaOf(full, early, true), guarded(early)));
    expect(back).toEqual(run(early));
  });

  /**
   * 2 to 4 cars over 4 laps, each with its own pace (a mini-sector 1.78 to 1.82 s, ± up to 30 ms each) and a start up to
   * 3 s late; the engine joins while the first car is between progress 5 and 95.
   */
  const joinArb = fc.integer({ min: 2, max: 4 }).chain((cars) =>
    fc.record({
      startsMs: fc.array(fc.integer({ min: 0, max: 3_000 }), { minLength: cars, maxLength: cars }),
      segmentsMs: fc.array(
        fc.integer({ min: 1_780, max: 1_820 }).chain((base) => fc.array(fc.integer({ min: base - 30, max: base + 30 }), { minLength: 4 * MINI_SECTORS, maxLength: 4 * MINI_SECTORS })),
        { minLength: cars, maxLength: cars },
      ),
      joinProgress: fc.integer({ min: 5, max: 95 }),
    }),
  );

  it("property: the gap between two cars at a point equals the from-the-start run's, every point from the origin on", () => {
    fc.assert(
      fc.property(joinArb, ({ startsMs, segmentsMs, joinProgress }) => {
        const all = byTime(
          startsMs.flatMap((start, i) => {
            let t = start;
            return Array.from({ length: 4 * MINI_SECTORS + 1 }, (_, k) => {
              t += segmentsMs[i]![Math.min(k, 4 * MINI_SECTORS - 1)]!;
              return { carId: carId(i), lap: Math.floor(k / MINI_SECTORS) + 1, segment: k % MINI_SECTORS, at: t, frame: 0 };
            });
          }),
        );
        const joinAt = all.find((m) => m.carId === 0 && progressOf(m) === joinProgress)!.at + 1;
        const fromStart = gapperLines(run(viewOf(all)), FIXED);
        const lines = gapperLines(run(joined(viewOf(after(all, joinAt)), joinAt)), FIXED);
        expect(lines.origin.known && lines.origin.value.kind).toBe('join');
        const origin = lines.origin.known && lines.origin.value.kind === 'join' ? lines.origin.value.lap : NaN;
        const cars = lines.cars.map((c) => c.carId as number).filter((id) => fromStart.cars.some((c) => c.carId === id));
        expect(cars).toContain(0);
        for (const a of cars) {
          const ja = new Map(pointsOf(lines, a));
          expect(ja.size, `car ${a}`).toBeGreaterThan(0);
          for (const p of ja.keys()) expect(p, `car ${a}`).toBeGreaterThanOrEqual(progressAtX(origin));
          for (const b of cars) {
            if (b <= a) continue;
            const jb = new Map(pointsOf(lines, b));
            const sa = new Map(pointsOf(fromStart, a));
            const sb = new Map(pointsOf(fromStart, b));
            for (const p of [...ja.keys()].filter((q) => jb.has(q))) expect(plain(ja.get(p)! - jb.get(p)!), `${a}-${b} at ${p}`).toBe(plain(sa.get(p)! - sb.get(p)!));
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('gapperLines and the ghost lines in a joined race (row 3)', () => {
  it('the default reference (leader average) is known and every car in the window has a line and a point now', () => {
    const lines = gapperLines(run(joinedView(FULL.filter((m) => m.at < 400_000))), LEADER);
    expect(lines.referenceLapMs.known).toBe(true);
    expect(lines.cars.map((c) => c.carId as number).sort()).toEqual([0, 1, 2]);
    for (const car of lines.cars) {
      expect(car.points.length, `car ${car.carId}`).toBeGreaterThan(0);
      expect(car.now.known, `car ${car.carId} now`).toBe(true);
    }
  });

  it("rejoin's ghost lines are non-empty: each of our cars, each condition, has points", () => {
    const LOSSES: Record<PitCondition, Known<Ms>> = { green: known(20_300, 0), vsc: known(13_100, 0), sc: known(9_800, 0) };
    const out = run(joinedView(FULL.filter((m) => m.at < 400_000)));
    const ghost = ghostLinesOf({ gaps: out, losses: LOSSES, ourCars: [carId(0), carId(2)], ghostLaps: REJOIN_CONFIG.defaults.ghostLaps }, LEADER);
    expect(ghost.lines).toHaveLength(6);
    for (const line of ghost.lines) expect(line.points.length, `car ${line.carId} ${line.condition}`).toBeGreaterThan(0);
  });
});

describe("gaps: the leader's progress now (leaderProgress)", () => {
  /** The crossings of `list` up to the leader's (car 0) crossing at `progress`. */
  const upTo = (list: readonly MiniSectorCrossing[], progress: number) => {
    const at = list.find((m) => m.carId === 0 && progressOf(m) === progress)!.at;
    return list.filter((m) => m.at <= at);
  };

  it("is the leader's lap and the part of it crossed (mini-sectors / 50), from its newest crossing", () => {
    // the leader at progress 70: lap 2, 20 of 50 mini-sectors
    expect(run(viewOf(upTo(FULL, 70))).leaderProgress).toMatchObject({ known: true, value: { lap: 2, fraction: 0.4 } });
    // at the line that completes lap 2: lap 3, nothing of it yet
    expect(run(viewOf(upTo(FULL, 100))).leaderProgress).toMatchObject({ known: true, value: { lap: 3, fraction: 0 } });
  });

  it('is the leader of the order (position 1), not the first car slot', () => {
    const list = race([1_000, 0], 3);
    const at = list.find((m) => m.carId === 1 && progressOf(m) === 60)!.at;
    expect(run(viewOf(list.filter((m) => m.at <= at))).leaderProgress).toMatchObject({ known: true, value: { lap: 2, fraction: 0.2 } });
  });

  it('is notReceived before any crossing (C3: never 0)', () => {
    expect(run(viewOf([], { lightsOutAt: null })).leaderProgress).toEqual(unknown('notReceived'));
  });

  it('is known in a joined race too', () => {
    expect(run(joinedView(upTo(FULL, 120))).leaderProgress).toMatchObject({ known: true, value: { lap: 3, fraction: 0.4 } });
  });

  it('update over deltas equals init: the leader progress follows each crossing', () => {
    const early = viewOf(upTo(FULL, 70));
    const later = viewOf(upTo(FULL, 120));
    const out = gaps.output(gaps.update(gaps.init(guarded(early)), deltaOf(early, later), guarded(later)));
    expect(out.leaderProgress).toEqual(run(later).leaderProgress);
    expect(out.leaderProgress).toMatchObject({ known: true, value: { lap: 3, fraction: 0.4 } });
  });
});
