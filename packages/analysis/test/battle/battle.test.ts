// `battle` (timing spec 6.3, live polish spec 3.1): our cars against the car ahead and behind. The neighbours and the gaps
// are `gaps.intervals`'; PACE Δ comes from the mini-sector crossings (pace-window.test.ts holds its window); `margin` and
// `lapsToDrs` come from PACE Δ; DRS from race control's spans. Every number is positive when it is good for our car.
import { known, unknown, type BattleCard, type DrsStatus, type Known, type Ms } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { BATTLE, BATTLE_BEHAVIOUR, BATTLE_CONFIG } from '../../src/battle/index.ts';
import { battleCalculator } from '../../src/battle/calculator.ts';
import { NEUTRALISATION_READS } from '../../src/shared/neutralised.ts';
import { cardOf, cardsOf, closedDrs, crossingAt, deltaOf, guarded, id, viewOf, type Neutralised, type Run, type Scene } from './race.ts';

const NA = unknown('notApplicable');

/** A run at `ms` a segment from `startAt`. */
const run = (startAt: number, ms: number): Run => ({ startAt, ms: () => ms });

/**
 * Car 0 (ours, P3, 1.8 s a segment from 10 s) between car 1 (P2, ahead, 1.81 s a segment from 0) and car 3 (P4, behind,
 * 1.79 s a segment from 14 s), now at our crossing (4, 10): PACE Δ +500 ms a lap ahead (we are faster), −500 behind (it
 * is faster). Gaps from `gaps.intervals`: 1.6 s ahead, 2.2 s behind.
 */
const US = run(10_000, 1800);
const NOW = crossingAt(US, 4, 10);
const base = (over: Partial<Scene> = {}): Scene => ({
  now: NOW,
  runs: { 1: run(0, 1810), 0: US, 3: run(14_000, 1790) },
  order: [1, 0, 3],
  ...over,
});
/** The base with car 1 (ahead) or car 3 (behind) at `ms` a segment instead. */
const withPace = (n: 1 | 3, ms: number): Scene => {
  const s = base();
  return { ...s, runs: { ...s.runs, [n]: run(n === 1 ? 0 : 14_000, ms) } };
};

const sides = (c: BattleCard) => {
  if (!c.ahead.known || !c.behind.known) throw new Error('a side unknown');
  return { ahead: c.ahead.value, behind: c.behind.value };
};
const lapsToDrsOf = (c: BattleCard) => [c.ahead, c.behind].map((s) => (s.known ? s.value.lapsToDrs : s));
const value = (k: Known<number>): number => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};
/** lapsToDrs 1.2 ahead ((1600 − 1000) / 500) and 2.4 behind ((2200 − 1000) / 500), as in the base. */
const BASE_LAPS_TO_DRS = [expect.objectContaining({ known: true, value: 1.2 }), expect.objectContaining({ known: true, value: 2.4 })];

describe('battle', () => {
  it('is the incremental calculator battle, run every frame, reading gaps, the mini-sectors, car location, the neutralisations, tyres, energy, identity, race control and the weekend phase', () => {
    expect(battleCalculator.id).toBe(BATTLE);
    expect(battleCalculator.kind).toBe('incremental');
    expect(battleCalculator.cadence).toBe('frame');
    const reads = [{ calculator: 'gaps' }, 'miniSectors', 'spans:car-location', ...NEUTRALISATION_READS, 'tyres', 'energy', 'identity', 'spans:race-control-race', 'spans:weekend-phase'];
    expect(battleCalculator.reads).toEqual(expect.arrayContaining(reads));
    expect(battleCalculator.reads).toHaveLength(reads.length);
  });

  it('no longer reads pace, nor events (spec 3.1)', () => {
    expect(battleCalculator.reads).not.toContainEqual({ calculator: 'pace' });
    expect(battleCalculator.reads).not.toContain('events');
  });

  it('exports a behaviour table covering car location, the session phases, race control and the weekend phase (C44)', () => {
    expect(Object.keys(BATTLE_BEHAVIOUR).sort()).toEqual([
      'car-location',
      'race-control-race',
      'session-phase-practice',
      'session-phase-qualifying',
      'session-phase-race',
      'weekend-phase',
    ]);
  });

  it('the gaps are those of gaps.intervals, passed through with their times', () => {
    const { ahead, behind } = sides(cardOf(base()));
    expect(ahead.carId).toBe(id(1));
    expect(ahead.gapMs).toEqual(known(1600, NOW));
    expect(behind.carId).toBe(id(3));
    expect(behind.gapMs).toEqual(known(2200, NOW));
  });

  it('an unknown interval gap stays unknown with its reason', () => {
    const { ahead } = sides(cardOf(base({ gaps: { 0: { toAheadMs: unknown('notReceived') } } })));
    expect(ahead.gapMs).toEqual(unknown('notReceived'));
  });

  it('PACE Δ from the mini-sectors: positive ahead when we are faster, negative behind when it is', () => {
    const { ahead, behind } = sides(cardOf(base()));
    expect(ahead.paceDeltaMs).toMatchObject({ known: true, value: 500 });
    expect(behind.paceDeltaMs).toMatchObject({ known: true, value: -500 });
  });

  it('AHEAD margin is { pass, our edge − 1000 }, BEHIND { hold, 1000 − their edge }; positive = good for us on both', () => {
    // we gain 500 ms a lap on the car ahead: 500 short of a pass; the car behind gains 500 on us: we hold by 500
    const slow = sides(cardOf(base()));
    expect(slow.ahead.margin).toMatchObject({ known: true, value: { kind: 'pass', ms: -500 } });
    expect(slow.behind.margin).toMatchObject({ known: true, value: { kind: 'hold', ms: 500 } });
    // we gain 2.5 s a lap on the car ahead: a pass by 1.5 s; the car behind gains 1.5 s on us: we hold by −500
    const fast = sides(cardOf(base({ runs: { 1: run(0, 1850), 0: US, 3: run(14_000, 1770) } })));
    expect(fast.ahead.paceDeltaMs).toMatchObject({ known: true, value: 2500 });
    expect(fast.ahead.margin).toMatchObject({ known: true, value: { kind: 'pass', ms: 1500 } });
    expect(fast.behind.paceDeltaMs).toMatchObject({ known: true, value: -1500 });
    expect(fast.behind.margin).toMatchObject({ known: true, value: { kind: 'hold', ms: -500 } });
  });

  it('the overtaking threshold comes from the config, on both sides', () => {
    const { ahead, behind } = sides(cardOf(base({ config: { [BATTLE_CONFIG.key]: { overtakeThresholdMs: 2000 } } })));
    expect(ahead.margin).toMatchObject({ known: true, value: { kind: 'pass', ms: -1500 } });
    expect(behind.margin).toMatchObject({ known: true, value: { kind: 'hold', ms: 1500 } });
  });

  it("lapsToDrs from PACE Δ on both sides: (gap − DRS range) / the closing car's edge; 0 inside DRS range; notApplicable while the gap is not closing or DRS is off", () => {
    expect(lapsToDrsOf(cardOf(base()))).toEqual(BASE_LAPS_TO_DRS);
    // inside DRS range ahead: 0 as of the gap; behind (2200 − 1600) / 500
    const inRange = lapsToDrsOf(cardOf(base({ config: { [BATTLE_CONFIG.key]: { drsRangeMs: 1600 } } })));
    expect(inRange).toEqual([known(0, NOW), expect.objectContaining({ known: true, value: 1.2 })]);
    // not closing: the car ahead is faster than us or as fast, the car behind slower
    expect(lapsToDrsOf(cardOf(withPace(1, 1790)))[0]).toEqual(NA);
    expect(lapsToDrsOf(cardOf(withPace(1, 1800)))[0]).toEqual(NA);
    expect(lapsToDrsOf(cardOf(withPace(3, 1810)))[1]).toEqual(NA);
    // race control has DRS off
    expect(lapsToDrsOf(cardOf(base({ drs: { off: 'wetTrack' } })))).toEqual([NA, NA]);
  });

  it('the DRS range comes from the config', () => {
    const { ahead } = sides(cardOf(base({ config: { [BATTLE_CONFIG.key]: { drsRangeMs: 800 } } })));
    // (1600 − 800) / 500
    expect(value(ahead.lapsToDrs)).toBe(1.6);
  });

  it('with PACE Δ unknown, lapsToDrs and the margin carry its reason; a gap inside DRS range is still 0 laps to DRS', () => {
    // our 20th segment of the race: too few for PACE Δ
    const early = base({ now: crossingAt(US, 1, 20) });
    const { ahead, behind } = sides(cardOf(early));
    for (const side of [ahead, behind]) {
      expect(side.paceDeltaMs).toEqual(unknown('insufficientData'));
      expect(side.lapsToDrs).toEqual(unknown('insufficientData'));
      expect(side.margin).toEqual(unknown('insufficientData'));
    }
    const close = sides(cardOf({ ...early, gaps: { 0: { toAheadMs: known(900, early.now) } } }));
    expect(close.ahead.lapsToDrs).toEqual(known(0, early.now));
  });

  it('CLOSING and the old overtaking margin are written notApplicable on both sides until they are removed', () => {
    const { ahead, behind } = sides(cardOf(base()));
    for (const side of [ahead, behind]) {
      expect(side.closingMsPerLap).toEqual(NA);
      expect(side.overtakeMarginMs).toEqual(NA);
    }
  });

  it('compound and tyre age of both cars come from the car states', () => {
    const { ahead } = sides(cardOf(base({ carOver: { 0: { tyres: { visualCompound: 'medium', age: 7 } }, 1: { tyres: { visualCompound: 'hard', age: 12 } } } })));
    expect(ahead.ours).toEqual({ compound: 'medium', age: 7 });
    expect(ahead.theirs).toEqual({ compound: 'hard', age: 12 });
  });

  it('their ERS store is the car state value with its time', () => {
    const ers = known({ storeJ: 2_500_000, mode: 'medium' as const, harvestedMgukJ: 0, harvestedMguhJ: 0, deployedJ: 0 }, 42_000);
    const { ahead } = sides(cardOf(base({ carOver: { 1: { energy: { ers } } } })));
    expect(ahead.theirErsStoreJ).toEqual(known(2_500_000, 42_000));
  });

  it('no car ahead (we lead): ahead is notApplicable', () => {
    const c = cardOf(base({ order: [0, 1, 3] }));
    expect(c.carId).toBe(id(0));
    expect(c.ahead).toEqual(NA);
    expect(c.behind).toMatchObject({ known: true });
  });

  it('no car behind (we are last): behind is notApplicable', () => {
    expect(cardOf(base({ order: [3, 1, 0] })).behind).toEqual(NA);
  });

  it('a retired car is never ahead or behind: the neighbours are those of gaps.intervals', () => {
    // car 2 P1, car 1 P2 (retired), car 0 P3 (ours), car 3 P4 (disqualified), car 4 P5: gaps.intervals leaves 1 and 3 out
    const s = base();
    const { ahead, behind } = sides(cardOf({ ...s, runs: { ...s.runs, 2: run(0, 1810), 4: run(14_000, 1790) }, order: [2, 0, 4] }));
    expect(ahead.carId).toBe(id(2));
    expect(behind.carId).toBe(id(4));
    expect(ahead.paceDeltaMs).toMatchObject({ known: true, value: 500 });
  });

  it('realism: theirErsStoreJ unknown(realism); the gap, PACE Δ, the margin and lapsToDrs still known (the crossings are public)', () => {
    const { ahead, behind } = sides(cardOf(base({ hidden: [1, 3] })));
    for (const side of [ahead, behind]) {
      expect(side.theirErsStoreJ).toMatchObject({ known: false, reason: 'realism' });
      expect(side.gapMs).toMatchObject({ known: true });
      expect(side.paceDeltaMs).toMatchObject({ known: true });
      expect(side.margin).toMatchObject({ known: true });
      expect(side.lapsToDrs).toMatchObject({ known: true });
      expect(side.theirs).toEqual({ compound: 'soft', age: 0 });
    }
  });

  it('one card per car of ours: the player and the teammate', () => {
    expect(Object.keys(cardsOf(viewOf(base()))).sort()).toEqual(['0']);
    const out = cardsOf(viewOf(base({ teammate: 1 })));
    expect(Object.keys(out).sort()).toEqual(['0', '1']);
    expect(out[id(1)]!.carId).toBe(id(1));
    // the teammate (P2) has our car behind it, which gains 500 ms a lap on it
    const behind = out[id(1)]!.behind;
    if (!behind.known) throw new Error('behind unknown');
    expect(behind.value.carId).toBe(id(0));
    expect(behind.value.paceDeltaMs).toMatchObject({ known: true, value: -500 });
  });

  it('outside the race: every card notApplicable', () => {
    const out = cardsOf(viewOf(base({ phase: 'practice', drs: 'none', teammate: 1 })));
    expect(Object.keys(out).sort()).toEqual(['0', '1']);
    for (const c of Object.values(out)) {
      expect(c.ahead).toEqual(NA);
      expect(c.behind).toEqual(NA);
    }
  });

  it('a race without the gaps output: the sides are notReceived, the card still carries the DRS status', () => {
    expect(cardOf(base({ noGaps: true, drs: { off: 'redFlag' } }))).toEqual({
      carId: id(0),
      ahead: unknown('notReceived'),
      behind: unknown('notReceived'),
      drs: { enabled: false, reason: 'redFlag' },
    });
  });
});

describe('battle: incremental equals from scratch (C31.3, Review Focus 4)', () => {
  /**
   * The base race frame by frame, every 900 ms, with an SC out from 200 s. During it, at 230 s, a flashback goes back to
   * 215 s; in the run after it our car runs 25 ms a segment slower from (3, 20) on, which we cross at 226 s, and the SC
   * comes in at 250 s; the race goes on to 330 s. At every frame, the rewind's included, the folded accumulator equals
   * `init` over the frame's projection and the cards equal those from scratch.
   */
  const FRAME_MS = 900;
  const REWIND_FROM = 230_000;
  const REWIND_TO = 215_000;
  const SC_IN = 250_000;
  const before = base();
  const slower: Run = { startAt: US.startAt, ms: (lap, segment) => (lap > 3 || (lap === 3 && segment >= 20) ? 1825 : 1800) };
  const after: Scene = { ...before, runs: { ...before.runs, 0: slower } };
  const sc = (t: number, closes?: number): Neutralised[] =>
    t < 200_000 ? [] : [{ kind: 'SC', from: 200_000, ...(closes !== undefined && t >= closes && { to: closes }) }];
  const frames = (from: number, to: number): number[] => Array.from({ length: Math.floor((to - from) / FRAME_MS) + 1 }, (_, i) => from + i * FRAME_MS);
  const timeline: Array<{ view: EngineView; rewound?: { frameId: number; at: number } }> = [
    ...frames(0, REWIND_FROM).map((t) => ({ view: viewOf({ ...before, now: t, neutralised: sc(t) }) })),
    { view: viewOf({ ...after, now: REWIND_TO, neutralised: sc(REWIND_TO, SC_IN) }), rewound: { frameId: REWIND_TO, at: REWIND_TO } },
    ...frames(REWIND_TO + FRAME_MS, 330_000).map((t) => ({ view: viewOf({ ...after, now: t, neutralised: sc(t, SC_IN) }) })),
  ];

  it('at every frame, also after a rewind during an SC, the accumulator equals init and the cards equal those from scratch', () => {
    let prev = timeline[0]!.view;
    let acc = battleCalculator.init(guarded(prev));
    let paceKnown = 0;
    timeline.slice(1).forEach(({ view, rewound }, i) => {
      const step = guarded({ ...view, delta: deltaOf(prev, view, rewound) });
      acc = battleCalculator.update(acc, step.delta, step);
      const at = `frame ${i + 1} at ${view.live.sessionTime}`;
      expect(acc, at).toEqual(battleCalculator.init(guarded(view)));
      const out = battleCalculator.output(acc, step);
      expect(out, at).toEqual(cardsOf(view));
      const ahead = out[id(0)]?.ahead;
      if (ahead?.known && ahead.value.paceDeltaMs.known) paceKnown++;
      prev = view;
    });
    // no empty run: PACE Δ is known on most frames, the SC's and the rewind's included
    expect(paceKnown).toBeGreaterThan(timeline.length / 2);
  });
});

describe('battle: the behaviour table (C44), one test per row', () => {
  const ENABLED: DrsStatus = { enabled: true };

  describe('weekend-phase', () => {
    it('race: the cards are computed (both sides known, lapsToDrs known while DRS is on)', () => {
      const c = cardOf(base({ phase: 'race' }));
      const { ahead, behind } = sides(c);
      expect(ahead.carId).toBe(id(1));
      expect(behind.carId).toBe(id(3));
      expect(lapsToDrsOf(c)).toEqual(BASE_LAPS_TO_DRS);
    });

    for (const phase of ['practice', 'qualifying', 'none'] as const) {
      it(`${phase}: both sides notApplicable (C14); the card still carries the DRS status, enabled (no race control)`, () => {
        expect(cardOf(base({ phase, drs: 'none' }))).toEqual({ carId: id(0), ahead: NA, behind: NA, drs: ENABLED });
      });
    }
  });

  describe('race-control-race', () => {
    it('drsOn: every card has DRS enabled and lapsToDrs known', () => {
      const out = cardsOf(viewOf(base({ teammate: 1, drs: 'drsOn' })));
      expect(Object.values(out).map((c) => [c.carId, c.drs])).toEqual([[id(0), ENABLED], [id(1), ENABLED]]);
      expect(lapsToDrsOf(out[id(0)]!)).toEqual(BASE_LAPS_TO_DRS);
    });

    for (const reason of ['notEnabledYet', 'wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached', 'unknown'] as const) {
      it(`drsOff (${reason}): every card has DRS off with the span's reason; lapsToDrs notApplicable, the other fields those of drsOn`, () => {
        const out = cardsOf(viewOf(base({ teammate: 1, drs: { off: reason } })));
        for (const c of Object.values(out)) expect(c.drs).toEqual({ enabled: false, reason });
        const on = sides(cardOf(base()));
        const off = sides(cardOf(base({ drs: { off: reason } })));
        expect(off.ahead).toEqual({ ...on.ahead, lapsToDrs: NA });
        expect(off.behind).toEqual({ ...on.behind, lapsToDrs: NA });
      });
    }

    it('drsOff: a side already inside DRS range has lapsToDrs notApplicable, not 0', () => {
      const c = cardOf(base({ drs: { off: 'notEnabledYet' }, config: { [BATTLE_CONFIG.key]: { drsRangeMs: 1600 } } }));
      expect(lapsToDrsOf(c)).toEqual([NA, NA]);
    });

    it('drsOn after a closed drsOff of the history: lapsToDrs is known again; only the open span counts', () => {
      const c = cardOf(base({ drs: 'drsOn', closedDrs: [closedDrs(0, { off: 'wetTrack' }, 0, 200_000)] }));
      expect(c.drs).toEqual(ENABLED);
      expect(lapsToDrsOf(c)).toEqual(BASE_LAPS_TO_DRS);
    });

    it('a race joined late (a drsOn span from the join, no DRS event in the history): the same card as with a full history', () => {
      const late = cardOf(base({ drs: 'drsOn' }));
      expect(late).toEqual(cardOf(base()));
      expect(late.drs).toEqual(ENABLED);
    });
  });

  /**
   * Car `car` 300 ms slower in each of segments (3, 30) to (3, 34), off the track over them when `kind` is given; now at
   * our crossing (4, 10), so the window (3, 10) to (4, 9) holds them. Every other segment is as in the base: a skipped
   * segment leaves PACE Δ at the base's 500, a counted one moves it by 1.5 s.
   */
  const slowIn = (car: 0 | 1, over: { kind?: 'pitLane' | 'garage'; neutralised?: Partial<Neutralised> } = {}): Scene => {
    const s = base();
    const r = s.runs[car]!;
    const ms = r.ms(1, 0);
    const slow: Run = { startAt: r.startAt, ms: (lap, segment) => (lap === 3 && segment >= 30 && segment <= 34 ? ms + 300 : ms) };
    const runs = { ...s.runs, [car]: slow };
    const into = (segment: number) => crossingAt(slow, 3, segment) + 100;
    return {
      ...s,
      runs,
      now: crossingAt(runs[0]!, 4, 10),
      ...(over.kind && { pitLane: [{ car, kind: over.kind, from: into(30), to: into(34) }] }),
      ...(over.neutralised && { neutralised: [{ from: into(30), to: into(34), ...over.neutralised }] }),
    };
  };
  const paceOf = (s: Scene): Known<Ms> => sides(cardOf(s)).ahead.paceDeltaMs;

  describe('car-location', () => {
    it('track: the segment counts (our slow segments cost 1.5 s of PACE Δ, theirs give it)', () => {
      expect(paceOf(slowIn(0))).toMatchObject({ known: true, value: -1000 });
      expect(paceOf(slowIn(1))).toMatchObject({ known: true, value: 2000 });
    });

    for (const kind of ['pitLane', 'garage'] as const) {
      it(`${kind}: a segment of either car there is skipped`, () => {
        expect(paceOf(slowIn(0, { kind }))).toMatchObject({ known: true, value: 500 });
        expect(paceOf(slowIn(1, { kind }))).toMatchObject({ known: true, value: 500 });
      });
    }
  });

  describe('session-phase-race', () => {
    it('racing (and every kind but neutralised and suspended): the segment counts', () => {
      expect(paceOf(slowIn(0))).toMatchObject({ known: true, value: -1000 });
    });

    for (const kind of ['SC', 'VSC'] as const) {
      it(`neutralised (${kind}): a segment it covers is skipped`, () => {
        expect(paceOf(slowIn(0, { neutralised: { kind } }))).toMatchObject({ known: true, value: 500 });
      });
    }

    it('suspended (red flag): a segment it covers is skipped', () => {
      expect(paceOf(slowIn(0, { neutralised: { kind: 'red' } }))).toMatchObject({ known: true, value: 500 });
    });

    it('a neutralised span closed unconfirmed was no neutralisation (C18): its segments count', () => {
      expect(paceOf(slowIn(0, { neutralised: { kind: 'SC', confirmed: false } }))).toMatchObject({ known: true, value: -1000 });
    });
  });
});
