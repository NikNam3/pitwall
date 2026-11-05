// `damage` measuring and the early estimate (live polish spec 3.5): per jump, `measuring` counts the `forPace` laps after
// it while its loss is measured, and `estimateMsPerLap` sums the car's eligible mini-sectors since the jump against its
// segment medians frozen at the jump (`shared/segment-medians.ts`), scaled to 50 segments. Mini-sectors in the engine's
// convention: segment 0 of lap L is the line at its start, mini-sector (L, s) runs from crossing (L, s) to the next one
// and covers the frames from its start crossing's up to, not including, its end crossing's (C26). Every crossing, lap,
// event and span describes the frame numbered by its time (`frame = at`), so frames and times agree. Every test runs the
// calculator through its guarded view (C41).
import {
  carId,
  known,
  MINI_SECTORS,
  unknown,
  type CarId,
  type DamageJump,
  type LapRecord,
  type MiniSectorCrossing,
  type OpenSpan,
  type RaceEvent,
  type Span,
  type WeekendPhase,
} from '@pitwall/domain';
import { projectionLengths, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { carState, event, lap as lapRecord, neutralisation, openNeutralisation } from '../../../../test-support/builders/index.ts';
import { damageCalculator as unguarded } from '../../src/damage/calculator.ts';
import { DAMAGE_CONFIG } from '../../src/damage/index.ts';
import { guardedIncremental, RACE, situatedView } from '../situated.ts';
import { scheduled } from '../scheduled.ts';

const damage = scheduled(guardedIncremental(unguarded));

const car0 = carId(0);
const car1 = carId(1);

/** One mini-sector at 90 s a lap. */
const SEGMENT_MS = 90_000 / MINI_SECTORS;
/** The laps of a scenario: crossings (1, 0) .. (LAPS, 49) and the closing (LAPS + 1, 0). */
const LAPS = 10;
/** The jump: on the frame of crossing (5, 10). Mini-sectors from (5, 10) on are since it; the one ending at it is before it. */
const JUMP = { lap: 5, segment: 10 } as const;
/** Whether mini-sector (lap, segment) starts at or after the crossing of `jump`. */
const sinceJump = (lap: number, segment: number, jump: { lap: number; segment: number } = JUMP) =>
  lap > jump.lap || (lap === jump.lap && segment >= jump.segment);

/** A pit visit of a car (its `pitLane` car-location span), or a neutralisation, by session time; `to` undefined: still open. */
type Cover = { from: number; to?: number };

type Scenario = {
  /** Extra ms of mini-sector (lap, segment) of car 0 over its 1 800 ms. */
  slow?: (lap: number, segment: number) => number;
  /** Laps of car 0 that are not valid, so no `forPace` lap (`lap-classes`); their mini-sectors stay eligible. */
  invalid?: readonly number[];
  /** Pit visits of car 0, as functions of its crossing times. */
  pits?: (at: CrossingAt) => Cover[];
  /** Pit visits of car 1 (a car with no crossings), as functions of car 0's crossing times. */
  otherPits?: (at: CrossingAt) => Cover[];
  /** SC neutralisations (`session-phase-race` `neutralised` spans), as functions of car 0's crossing times. */
  neutralised?: (at: CrossingAt) => Cover[];
  /** The crossing the jump is on (default `JUMP`). */
  jump?: { lap: number; segment: number };
  phase?: WeekendPhase;
  config?: Record<string, number>;
};

/** Car 0's crossing time of boundary (lap, segment). */
type CrossingAt = (lap: number, segment: number) => number;

/** Car 0's crossings (1, 0) .. (LAPS + 1, 0): mini-sector (lap, segment) takes 1 800 ms plus `slow(lap, segment)`. */
function crossingsOf(slow: (lap: number, segment: number) => number): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  let at = 0;
  for (let lap = 1; lap <= LAPS + 1; lap++) {
    for (let segment = 0; segment < MINI_SECTORS; segment++) {
      list.push({ carId: car0, lap, segment, at, frame: at });
      if (lap === LAPS + 1) return list;
      at += SEGMENT_MS + slow(lap, segment);
    }
  }
  return list;
}

/** A car's contiguous car-location spans: on track from 0 (joined there), in the pit lane for each visit, on track after it. */
function locationSpans(car: CarId, visits: readonly Cover[]): Array<Span | OpenSpan> {
  const steps: { kind: string; at: number }[] = [{ kind: 'track', at: 0 }];
  for (const { from, to } of visits) {
    steps.push({ kind: 'pitLane', at: from });
    if (to !== undefined) steps.push({ kind: 'track', at: to });
  }
  return steps.map(({ kind, at }, id) => {
    const open: OpenSpan = { machine: 'car-location', id, kind, start: at, confirmed: true, detail: undefined, startFrame: at, carId: car, ...(id === 0 && { joinedAt: true as const }) };
    const next = steps[id + 1];
    return next === undefined ? open : { ...open, end: next.at, endFrame: next.at };
  });
}

/** The span as the view holds it at time `t` (C20): opened by then; one that closes after `t` is still open. */
const asOf = (span: Span | OpenSpan, t: number): Span | OpenSpan | undefined => {
  if (span.start > t) return undefined;
  if (!('endFrame' in span) || span.end <= t) return span;
  const { end: _end, endFrame: _endFrame, ...open } = span;
  return open;
};

/** The scenario's view at car 0's crossing (lap, segment): every crossing, lap, event and span up to its time. */
function viewAt(s: Scenario, lap: number, segment: number): EngineView {
  const all = crossingsOf(s.slow ?? (() => 0));
  const at: CrossingAt = (l, seg) => all.find((c) => c.lap === l && c.segment === seg)!.at;
  const t = at(lap, segment);
  const crossings = all.filter((c) => c.at <= t);
  const invalid = new Set(s.invalid ?? []);
  const laps: LapRecord[] = [];
  for (let l = 1; l <= LAPS; l++) {
    const end = at(l + 1, 0);
    if (end > t) break;
    const lapTimeMs = end - at(l, 0);
    laps.push(lapRecord({ carId: car0, lapNumber: l, lapTimeMs, completedAt: end, frame: end, ...(invalid.has(l) && { valid: { lap: false, sectors: [true, true, true] } }) }));
  }
  const jump = s.jump ?? JUMP;
  const jumpAt = at(jump.lap, jump.segment);
  const events: RaceEvent[] =
    jumpAt > t ? [] : [event({ kind: 'damageChange', carId: car0, at: jumpAt, frame: jumpAt, params: { part: 'frontRightWingPct', fromPct: 0, toPct: 20 } })];
  const sc = (s.neutralised?.(at) ?? []).map(({ from, to }, id) =>
    to === undefined ? openNeutralisation({ start: from, id }) : neutralisation({ start: from, end: to, id }),
  );
  const spans = [...locationSpans(car0, s.pits?.(at) ?? []), ...locationSpans(car1, s.otherPits?.(at) ?? []), ...sc]
    .map((span) => asOf(span, t))
    .filter((span) => span !== undefined);
  const closed: Record<string, Span[]> = {};
  const open: OpenSpan[] = [];
  for (const span of spans) {
    if ('endFrame' in span) (closed[span.machine] ??= []).push(span);
    else open.push(span);
  }
  for (const list of Object.values(closed)) list.sort((a, b) => a.endFrame - b.endFrame);
  return situatedView({
    cars: [carState({ id: car0, timing: { lap } }), carState({ id: car1 })],
    history: { crossings, laps, events, spans: closed },
    spans: open,
    phase: s.phase ?? RACE,
    config: { damage: s.config ?? {} },
    sessionTime: t,
  });
}

/** Car 0's only jump at crossing (lap, segment), from a fresh run. */
function jumpAt(s: Scenario, lap: number, segment: number): DamageJump {
  const jumps = damage.output(damage.init(viewAt(s, lap, segment)))[car0]!.jumps;
  expect(jumps).toHaveLength(1);
  return jumps[0]!;
}

const estimate = (jump: DamageJump) => jump.estimateMsPerLap;
const measuring = (jump: DamageJump) => jump.measuring;
/** A known estimate of `ms` per lap (its `at` is the calculator's). */
const knownMs = (ms: number) => expect.objectContaining({ known: true, value: ms });
const lapsOf = (lapsDone: number) => expect.objectContaining({ known: true, value: { lapsDone, lapsNeeded: 2 } });

describe('damage: measuring and the early estimate (spec 3.5)', () => {
  it('minEstimateSegments is 10 by default', () => {
    expect(DAMAGE_CONFIG.defaults.minEstimateSegments).toBe(10);
  });

  // Row 1. Laps 1..4 at 1 800 ms a mini-sector: every segment's median is 1 800 ms at the jump.
  it('right after a jump: measuring 0 of 2 laps, the estimate insufficientData', () => {
    const jump = jumpAt({}, JUMP.lap, JUMP.segment);
    expect(jump.lossMsPerLap).toEqual(unknown('insufficientData'));
    expect(measuring(jump)).toEqual(lapsOf(0));
    expect(estimate(jump)).toEqual(unknown('insufficientData'));
  });

  // Row 2. Mini-sectors (5, 10) .. (5, 19) are 10, 20, ..., 100 ms slower than their 1 800 ms median: 550 ms in all.
  describe('the estimate after minEstimateSegments eligible mini-sectors', () => {
    const slowed: Scenario = { slow: (lap, segment) => (lap === 5 && segment >= 10 && segment < 20 ? 10 * (segment - 9) : 0) };

    it('is insufficientData after 9 mini-sectors since the jump', () => {
      expect(estimate(jumpAt(slowed, 5, 19))).toEqual(unknown('insufficientData'));
    });

    it('after 10: the sum of (time − frozen median) scaled to 50 segments, 550 × 50 / 10', () => {
      expect(estimate(jumpAt(slowed, 5, 20))).toEqual(knownMs((550 * 50) / 10));
    });

    it('scales by the mini-sectors counted: after 20 (the last 10 at their median) 550 × 50 / 20', () => {
      expect(estimate(jumpAt(slowed, 5, 30))).toEqual(knownMs((550 * 50) / 20));
    });

    it('minEstimateSegments comes from the config section damage', () => {
      // (5, 10) .. (5, 14): 10 + 20 + 30 + 40 + 50 = 150 ms over 5 mini-sectors
      const five = { ...slowed, config: { minEstimateSegments: 5 } };
      expect(estimate(jumpAt(five, 5, 14))).toEqual(unknown('insufficientData'));
      expect(estimate(jumpAt(five, 5, 15))).toEqual(knownMs((150 * 50) / 5));
    });
  });

  // Row 3. Every mini-sector since the jump is 200 ms slow; laps 6..9 are invalid, so the loss is still being measured
  // while four slow laps pass: a baseline that took them in would sit at 2 000 ms and estimate about nothing.
  it('the baseline ignores every crossing after the jump: slow damaged laps do not move it', () => {
    const damaged: Scenario = { slow: (lap, segment) => (sinceJump(lap, segment) ? 200 : 0), invalid: [6, 7, 8, 9] };
    for (const lap of [6, 7, 8, 9, 10]) {
      const jump = jumpAt(damaged, lap, 0);
      expect(measuring(jump), `at lap ${lap}`).toEqual(lapsOf(0));
      expect(estimate(jump), `at lap ${lap}`).toEqual(knownMs(200 * 50));
    }
  });

  // Row 4.
  describe('pit and neutralised mini-sectors are skipped', () => {
    // Since the jump every mini-sector is 100 ms slow, but (5, 12) and (5, 13) take 5 s longer in the pit lane and
    // (5, 20) and (5, 21) 3 s longer under the SC; the pit visit and the SC each cover a frame of those two only.
    const slow = (lap: number, segment: number) => {
      if (!sinceJump(lap, segment)) return 0;
      if (lap === 5 && (segment === 12 || segment === 13)) return 5_000;
      if (lap === 5 && (segment === 20 || segment === 21)) return 3_000;
      return 100;
    };
    const pits = (at: CrossingAt): Cover[] => [{ from: at(5, 12) + 100, to: at(5, 13) + 100 }];
    const neutralised = (at: CrossingAt): Cover[] => [{ from: at(5, 20) + 50, to: at(5, 21) + 50 }];

    it('a pit visit and an SC: 13 mini-sectors since the jump, 4 skipped, are 9 and not enough; 14 are 10, each 100 ms slow', () => {
      const covered: Scenario = { slow, pits, neutralised };
      expect(estimate(jumpAt(covered, 5, 23))).toEqual(unknown('insufficientData'));
      expect(estimate(jumpAt(covered, 5, 24))).toEqual(knownMs(100 * 50));
    });

    it('an open neutralisation skips every mini-sector from the one it opened in', () => {
      // (5, 20) on are 3 s slow under a VSC still out: only (5, 10) .. (5, 19) count
      const vsc: Scenario = {
        slow: (lap, segment) => (!sinceJump(lap, segment) ? 0 : lap === 5 && segment < 20 ? 100 : 3_000),
        neutralised: (at) => [{ from: at(5, 20) + 50 }],
      };
      expect(estimate(jumpAt(vsc, 5, 40))).toEqual(knownMs(100 * 50));
    });

    it("another car's pit visit does not skip car 0's mini-sectors", () => {
      // (5, 10) .. (5, 19): 8 at +100 ms and two at +5 000 ms = 10 800 ms
      expect(estimate(jumpAt({ slow, otherPits: pits }, 5, 20))).toEqual(knownMs((10_800 * 50) / 10));
    });

    it('neutralised mini-sectors before the jump stay out of its baseline', () => {
      // the jump on (8, 10); an SC over (L, 30) .. (L, 39) on laps 5, 6 and 7 makes them 3 s slow: counted, they would be
      // 3 of those segments' last 5 samples and set their median at 4 800 ms; skipped, laps 1..4 leave it at 1 800 ms
      const jump = { lap: 8, segment: 10 };
      const early: Scenario = {
        jump,
        slow: (lap, segment) => (lap >= 5 && lap <= 7 && segment >= 30 && segment < 40 ? 3_000 : sinceJump(lap, segment, jump) ? 100 : 0),
        neutralised: (at) => [5, 6, 7].map((lap) => ({ from: at(lap, 30) + 50, to: at(lap, 39) + 50 })),
      };
      // (8, 10) .. (8, 49): 40 mini-sectors, each 100 ms slow
      expect(estimate(jumpAt(early, 9, 0))).toEqual(knownMs(100 * 50));
    });
  });

  // Row 5. Since the jump every mini-sector is 200 ms slow: laps 6 and 7 take 100 s against 90 s before.
  describe('after two forPace laps the loss is measured', () => {
    const damaged: Scenario = { slow: (lap, segment) => (sinceJump(lap, segment) ? 200 : 0) };

    it('measuring counts the forPace laps after the jump lap: 0 at its end, 1 after lap 6; the estimate meanwhile known', () => {
      const five = jumpAt(damaged, 6, 0);
      expect(measuring(five)).toEqual(lapsOf(0));
      expect(estimate(five)).toEqual(knownMs(200 * 50));
      const six = jumpAt(damaged, 7, 0);
      expect(six.lossMsPerLap).toEqual(unknown('insufficientData'));
      expect(measuring(six)).toEqual(lapsOf(1));
      expect(estimate(six)).toEqual(knownMs(200 * 50));
    });

    it('then lossMsPerLap is known and measuring and the estimate are notApplicable', () => {
      const seven = jumpAt(damaged, 8, 0);
      expect(seven.lossMsPerLap).toEqual(known(10_000, viewAt(damaged, 8, 0).history.laps[6]!.completedAt));
      expect(measuring(seven)).toEqual(unknown('notApplicable'));
      expect(estimate(seven)).toEqual(unknown('notApplicable'));
    });

    it('an invalid lap after the jump is no forPace lap and does not count', () => {
      const invalid6 = { ...damaged, invalid: [6] };
      expect(measuring(jumpAt(invalid6, 7, 0))).toEqual(lapsOf(0));
      expect(measuring(jumpAt(invalid6, 8, 0))).toEqual(lapsOf(1));
      const done = jumpAt(invalid6, 9, 0);
      expect(done.lossMsPerLap).toMatchObject({ known: true, value: 10_000 });
      expect(measuring(done)).toEqual(unknown('notApplicable'));
      expect(estimate(done)).toEqual(unknown('notApplicable'));
    });
  });

  // Row 6. Laps 2..4 invalid and lap 1 of a race no pace lap: no pace lap before the jump, its loss can never be measured.
  it('a jump with no pace laps before it: lossMsPerLap and measuring notApplicable, the estimate stays', () => {
    const unmeasurable: Scenario = { slow: (lap, segment) => (sinceJump(lap, segment) ? 200 : 0), invalid: [2, 3, 4] };
    for (const lap of [6, 8, 10]) {
      const jump = jumpAt(unmeasurable, lap, 0);
      expect(jump.lossMsPerLap, `at lap ${lap}`).toEqual(unknown('notApplicable'));
      expect(measuring(jump), `at lap ${lap}`).toEqual(unknown('notApplicable'));
      expect(estimate(jump), `at lap ${lap}`).toEqual(knownMs(200 * 50));
    }
  });

  // Row 7. `damage` is incremental (C31): its fold over the crossings and spans equals a fresh run at every crossing.
  describe('incremental equals from scratch', () => {
    // a pit visit after the jump, an SC before and one after it, slow mini-sectors since it; laps 7.. invalid
    const mixed: Scenario = {
      slow: (lap, segment) => (sinceJump(lap, segment) ? 150 + (segment % 7) * 10 : segment % 3),
      invalid: [7],
      pits: (at) => [{ from: at(5, 30) + 100, to: at(5, 33) + 100 }],
      otherPits: (at) => [{ from: at(5, 15) + 100, to: at(5, 16) + 100 }],
      neutralised: (at) => [
        { from: at(3, 5) + 50, to: at(3, 8) + 50 },
        { from: at(6, 20) + 50, to: at(6, 25) + 50 },
        { from: at(8, 40) + 50 },
      ],
    };
    const boundaries = crossingsOf(mixed.slow!).map((c) => [c.lap, c.segment] as const);

    it('at every crossing, through the jump, the pit visit, the SCs, the measured loss and an open SC', () => {
      let state = damage.init(viewAt(mixed, 1, 0));
      let before = viewAt(mixed, 1, 0);
      const seen = new Set<string>();
      for (const [lap, segment] of boundaries.slice(1)) {
        const view = viewAt(mixed, lap, segment);
        state = damage.update(state, { before: projectionLengths(before.history), after: projectionLengths(view.history) }, view);
        before = view;
        const out = damage.output(state);
        expect(out, `at (${lap}, ${segment})`).toEqual(damage.output(damage.init(view)));
        const jump = out[car0]!.jumps[0];
        if (jump?.estimateMsPerLap !== undefined) seen.add(jump.estimateMsPerLap.known ? 'estimate' : jump.estimateMsPerLap.reason);
        if (jump?.measuring.known === true) seen.add(`measuring ${jump.measuring.value.lapsDone}`);
      }
      // the run passes through every state of the jump: building, estimated while measuring, measured
      expect([...seen].sort()).toEqual(['estimate', 'insufficientData', 'measuring 0', 'measuring 1', 'notApplicable']);
    });

    it('a rewind to while the estimate is building, and to before the jump, equals a fresh run', () => {
      const full = viewAt(mixed, LAPS + 1, 0);
      const state = damage.update(damage.init(viewAt(mixed, 1, 0)), { before: projectionLengths(viewAt(mixed, 1, 0).history), after: projectionLengths(full.history) }, full);
      for (const [lap, segment] of [[5, 25], [4, 30]] as const) {
        const cut = viewAt(mixed, lap, segment);
        const delta = { before: projectionLengths(full.history), after: projectionLengths(cut.history), rewound: { frameId: -1, at: 0 } };
        const after = damage.output(damage.update(state, delta, { ...cut, delta }));
        expect(after, `rewound to (${lap}, ${segment})`).toEqual(damage.output(damage.init(cut)));
        // at (5, 25) the jump has 15 eligible mini-sectors and an estimate; at (4, 30) it never happened
        expect(after[car0]!.jumps.map((j) => j.estimateMsPerLap.known), `rewound to (${lap}, ${segment})`).toEqual(lap === 5 ? [true] : []);
      }
    });
  });
});
