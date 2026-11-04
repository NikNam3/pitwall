// `incidents` (spec 6.4) on situations (contract C20, C26, C43, C44, C45): pitting from car-location, retirements and
// disqualifications from car-status, penalties and warnings from the penalties and warnings spans, neutralisations from
// the session-phase spans, the race from the weekend phase; one test per row of its behaviour table. Every test runs
// the calculator through its guarded view (`race.ts`, C41).
import { describe, expect, it } from 'vitest';
import {
  carId,
  known,
  SPAN_DECLARATIONS,
  unknown,
  type CarId,
  type DamageParts,
  type IncidentEntry,
  type Known,
  type LapRecord,
  type RaceEvent,
  type WeekendPhase,
} from '@pitwall/domain';
import { event, lap, neutralisation, openNeutralisation } from '../../../../test-support/builders/index.ts';
import { incidentsCalculator } from '../../src/incidents/calculator.ts';
import * as unit from '../../src/incidents/index.ts';
import { DAMAGE } from '../../src/damage/index.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';
import type { BehaviourTable } from '../../src/shared/behaviour.ts';
import { behaviourExport } from '../units.ts';
import {
  boundaryAt,
  chain,
  damageState,
  deltaOf,
  incidents,
  leaderLaps,
  LAPS,
  location,
  owedStep,
  owes,
  PACE_MS,
  SEGMENT_MS,
  pitStop,
  PLAYER,
  race,
  RETIRED,
  run,
  runSteps,
  spansUntil,
  startOf,
  status,
  TRACK,
  until,
  viewOf,
  warned,
  type Delay,
} from './race.ts';

const { INCIDENTS, INCIDENTS_CONFIG } = unit;
const car = carId;
/** Mid-lap 5 of the player: between its boundaries (5, 24) at 407 400 and (5, 25) at 409 200. */
const T = 407_900;
const AFTER_MS = 5_000;

const valueOf = <T>(k: Known<T>): T | undefined => (k.known ? k.value : undefined);

const collision = (a: number, b: number, at = T): RaceEvent => event({ kind: 'collision', at, carId: car(a), otherCarId: car(b) });
/** A `damageChange` event of car `id` (car 7 by default): `part` goes from `fromPct` to `toPct`. */
const dmg = (at: number, part: keyof DamageParts, fromPct: number, toPct: number, id = 7): RaceEvent =>
  event({ kind: 'damageChange', at, carId: car(id), params: { part, fromPct, toPct } });

/** Car 7's lap records 1..count from its start: lap n takes `timeOf(n)` ms. */
const lapsOf7 = (count: number, timeOf: (n: number) => number): LapRecord[] => {
  let end = startOf(7);
  return Array.from({ length: count }, (_, i) => {
    end += timeOf(i + 1);
    return lap({ carId: car(7), lapNumber: i + 1, lapTimeMs: timeOf(i + 1), completedAt: end });
  });
};

const only = (feed: IncidentEntry[], kind: IncidentEntry['kind']): IncidentEntry => {
  const entries = feed.filter((e) => e.kind === kind);
  expect(entries, `entries of kind ${kind}`).toHaveLength(1);
  return entries[0]!;
};

const ofKind = (feed: IncidentEntry[], kind: IncidentEntry['kind']): IncidentEntry[] => feed.filter((e) => e.kind === kind);

/** A slow mini-sector of car 7 on lap 5, segment 10 (it enters it at boundary (5, 10)). */
const slow7 = (ms: number, segment = 10): Delay => ({ carId: car(7), lap: 5, segment, ms });
const SLOW_START = boundaryAt(7, 5, 10);
/** Where car 7's 2.5 s slow mini-sector ends: its crossing (5, 11), on the frame numbered by that time (`race`). */
const SLOW_END = SLOW_START + SEGMENT_MS + 2_500;

/** The sub-machines `incidents` reads, each a part of its behaviour table (C44). */
const MACHINES = [
  'car-location',
  'car-status',
  'penalties',
  'warnings',
  'session-phase-race',
  'session-phase-qualifying',
  'session-phase-practice',
  'weekend-phase',
] as const;

describe('incidents calculator', () => {
  it('is incremental over events, the situations it reads, mini-sectors and laps, and reads no damage output (a log reads the history only)', () => {
    expect(incidentsCalculator.id).toBe(INCIDENTS);
    expect(incidentsCalculator.kind).toBe('incremental');
    expect(incidentsCalculator.reads).toEqual(expect.arrayContaining(['events', 'miniSectors', 'laps', ...MACHINES.map((m) => `spans:${m}`)]));
    expect(incidentsCalculator.reads).not.toContainEqual({ calculator: DAMAGE });
  });

  it('a collision of the player car is a major entry with both cars', () => {
    const feed = run(viewOf({ miniSectors: race(), events: [collision(6, 5)] }));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      id: `collision:6-5:${T}`,
      at: T,
      lap: 5,
      kind: 'collision',
      severity: 'major',
      carIds: [car(6), car(5)],
    });
  });

  it('a collision of two cars outside the neighbourhood is not in the feed', () => {
    // Cars 0 and 1 are 4.2 s and 3.5 s ahead of the player and not within one position of it.
    expect(run(viewOf({ miniSectors: race(), events: [collision(0, 1)] }))).toEqual([]);
  });

  it('the neighbourhood comes from the crossings at the incident time, not from the live gaps output', () => {
    // a live gaps output whose neighbourhood would put cars 0 and 1 beside the player (only the fields that matter)
    const live: Partial<GapsOutput> = {
      phases: [],
      intervals: [],
      lineTimes: {},
      recent: {},
      neighbourhood: [{ ourCarId: PLAYER, carIds: [car(0), car(1)] }],
      raceStartAt: known(0, 0),
    };
    expect(run(viewOf({ miniSectors: race(), events: [collision(0, 1)], gaps: live }))).toEqual([]);
  });

  it('a retirement of a neighbour (its car-status span) is a major entry', () => {
    const entry = only(run(viewOf({ miniSectors: race(), spans: status(8, [{ kind: 'retired', at: T, detail: RETIRED }]) })), 'retirement');
    expect(entry).toMatchObject({ id: `retirement:8:${T}`, severity: 'major', carIds: [car(8)], lap: 5 });
  });

  it('a warning of a neighbour (its warned span) is a minor warning entry', () => {
    const entry = only(run(viewOf({ miniSectors: race(), spans: warned(7, [T]) })), 'warning');
    expect(entry).toMatchObject({ id: `warning:7:${T}`, at: T, severity: 'minor', carIds: [car(7)] });
    expect(entry.timeLostMs).toEqual(unknown('notApplicable'));
  });

  it('a penalty of a neighbour (its penalties span) is a minor penalty entry', () => {
    const entry = only(run(viewOf({ miniSectors: race(), spans: owes(7, [{ at: T, totalMs: 5_000 }]) })), 'penalty');
    expect(entry).toMatchObject({ id: `penalty:7:${T}`, severity: 'minor', carIds: [car(7)] });
    expect(entry.timeLostMs).toEqual(unknown('notApplicable'));
  });

  it('a damage jump of a neighbour (from its damageChange events) is a major damage entry; its time lost is the jump\'s pace delta', () => {
    // Car 7: 90 s laps up to lap 4, lap 5 (the hit) 92 s, then 90.8 s: the pace delta around lap 5 is +800 ms per lap.
    const laps = lapsOf7(7, (n) => (n <= 4 ? PACE_MS : n === 5 ? PACE_MS + 2_000 : PACE_MS + 800));
    const entry = only(run(viewOf({ miniSectors: race(), events: [dmg(T, 'frontLeftWingPct', 0, 20)], laps })), 'damage');
    expect(entry).toMatchObject({ id: `damage:7:${T}`, at: T, lap: 5, severity: 'major', carIds: [car(7)] });
    expect(entry.damage).toEqual([{ part: 'frontLeftWingPct', deltaPct: 20 }]);
    expect(entry.timeLostMs).toEqual(known(800, laps[6]!.completedAt));
  });

  it('a damage entry comes from the history only: a damage output with a jump and no damageChange event gives none', () => {
    const jump = { at: T, lap: 5, parts: ['frontLeftWingPct' as const], deltaPct: 20, lossMsPerLap: known(800, 500_000) };
    const damage = { [car(7)]: damageState([jump]) } as Record<CarId, ReturnType<typeof damageState>>;
    expect(run(viewOf({ miniSectors: race(), damage }))).toEqual([]);
  });

  it('the jump grouping follows the damage config: a 3 % rise is no entry by default and one with jumpPct 3', () => {
    const events = [dmg(T, 'floorPct', 0, 3)];
    expect(run(viewOf({ miniSectors: race(), events })).filter((e) => e.kind === 'damage')).toEqual([]);
    const entry = only(run(viewOf({ miniSectors: race(), events, damageConfig: { jumpPct: 3 } })), 'damage');
    expect(entry.damage).toEqual([{ part: 'floorPct', deltaPct: 3 }]);
  });

  it('an SC start is a minor neutralised entry with no cars', () => {
    const start = 400_000;
    const sc = neutralisation({ kind: 'SC', start, end: 460_000 });
    const entry = only(run(viewOf({ miniSectors: race(), phases: [sc], laps: leaderLaps(LAPS) })), 'neutralised');
    expect(entry).toMatchObject({ id: `neutralised::${start}`, at: start, lap: 5, severity: 'minor', carIds: [] });
    expect(entry.timeLostMs).toEqual(unknown('notApplicable'));
  });

  // Ruling 3 (Task 19): the leader's lap of a neutralisation comes from the projection's laps at the frame its span opened
  // on (C26, C45): one more than the most laps any car completed by that frame, that frame included.
  describe("the neutralised entry's lap: the leader's lap at the span's start frame, from the projection's laps", () => {
    const start = 400_000;
    const entryLap = (laps: LapRecord[], startFrame = start) =>
      only(run(viewOf({ miniSectors: race(), phases: [neutralisation({ kind: 'VSC', start, end: 460_000, startFrame })], laps })), 'neutralised').lap;

    it('counts the laps completed by that frame, not those after it', () => {
      expect(entryLap(leaderLaps(LAPS))).toBe(5);
      expect(entryLap(leaderLaps(LAPS), 360_000)).toBe(5);
      expect(entryLap(leaderLaps(LAPS), 359_999)).toBe(4);
    });
    it('is the most laps any car completed by then, whichever car: a lapped car does not lower it', () => {
      const ahead = [1, 2, 3, 4].map((n) => lap({ carId: car(9), lapNumber: n, completedAt: n * 85_000, frame: n * 85_000 }));
      const lapped = [1, 2].map((n) => lap({ carId: car(8), lapNumber: n, completedAt: n * 150_000, frame: n * 150_000 }));
      expect(entryLap([...leaderLaps(3), ...ahead, ...lapped])).toBe(5);
      expect(entryLap([...leaderLaps(3), ...lapped])).toBe(4);
    });
    it('is lap 1 before any lap is completed', () => {
      expect(entryLap([])).toBe(1);
    });
  });

  describe('time loss', () => {
    it('a mini-sector 2.5 s slower than the car\'s median is a major timeLoss entry; 1.5 s is none', () => {
      const entry = only(run(viewOf({ miniSectors: race({ delays: [slow7(2_500)] }) })), 'timeLoss');
      expect(entry).toMatchObject({ id: `timeLoss:7:${SLOW_START}`, at: SLOW_START, lap: 5, severity: 'major', carIds: [car(7)] });
      expect(valueOf(entry.timeLostMs)).toBe(2_500);

      expect(run(viewOf({ miniSectors: race({ delays: [slow7(1_500)] }) })).filter((e) => e.kind === 'timeLoss')).toEqual([]);
    });

    it('two slow mini-sectors in a row are one timeLoss entry from the first one\'s start, with their losses summed', () => {
      const entry = only(run(viewOf({ miniSectors: race({ delays: [slow7(2_500, 10), slow7(2_500, 11)] }) })), 'timeLoss');
      expect(entry.at).toBe(SLOW_START);
      expect(valueOf(entry.timeLostMs)).toBe(5_000);
    });

    it('a slow mini-sector inside an SC or a pit visit (the car\'s pitLane span) is no timeLoss', () => {
      const miniSectors = race({ delays: [slow7(2_500)] });
      const sc = neutralisation({ kind: 'SC', start: SLOW_START - 10_000, end: SLOW_START + 30_000 });
      const underSc = run(viewOf({ miniSectors, phases: [sc] }));
      expect(underSc.filter((e) => e.kind === 'timeLoss')).toEqual([]);

      const visit = location(7, [{ kind: 'pitLane', at: SLOW_START - 1_000 }, { kind: 'track', at: SLOW_START + 20_000 }]);
      expect(run(viewOf({ miniSectors, spans: visit })).filter((e) => e.kind === 'timeLoss')).toEqual([]);
    });

    it('timeLostMs first from the mini-sector, then from paceDelta once two laps exist', () => {
      const miniSectors = race({ delays: [slow7(2_500)] });
      // Car 7's laps: 90 s up to lap 4, 92.5 s for the lap of the loss, then 91 s: pace delta +1000 ms per lap.
      const lapTime = (n: number) => (n <= 4 ? PACE_MS : n === 5 ? PACE_MS + 2_500 : PACE_MS + 1_000);
      let end = startOf(7);
      const laps = [1, 2, 3, 4, 5, 6, 7].map((n) => {
        end += lapTime(n);
        return lap({ carId: car(7), lapNumber: n, lapTimeMs: lapTime(n), completedAt: end });
      });
      const at = (n: number) => laps[n - 1]!.completedAt;
      const views = [5, 6, 7].map((n) => viewOf({ miniSectors: until(miniSectors, at(n)), laps: laps.slice(0, n) }));

      const fiveLaps = run(views[0]!);
      expect(valueOf(only(fiveLaps, 'timeLoss').timeLostMs)).toBe(2_500);
      // One lap after the loss is not enough for paceDelta.
      expect(valueOf(only(runSteps(views.slice(0, 2)), 'timeLoss').timeLostMs)).toBe(2_500);

      // The update replaces the entry (same id), it does not add one.
      const sevenLaps = runSteps(views);
      const entry = only(sevenLaps, 'timeLoss');
      expect(entry.id).toBe(only(fiveLaps, 'timeLoss').id);
      expect(valueOf(entry.timeLostMs)).toBe(1_000);
    });
  });

  describe('forUs, without inventing', () => {
    it('positionBefore is notReceived while our car has no crossing at that moment (no invented position)', () => {
      // our car (6) crosses its first boundary at 4 200 ms; the collision is at 1 000 ms
      const us = only(run(viewOf({ miniSectors: until(race(), 3_000), events: [collision(6, 5, 1_000)] })), 'collision').forUs[0]!;
      expect(us.positionBefore).toEqual(unknown('notReceived'));
    });

    it('a neutralised entry concerns us with no other car: otherCarId and the gaps are notApplicable', () => {
      const phase = neutralisation({ kind: 'SC', start: T, end: T + 60_000 });
      const us = only(run(viewOf({ miniSectors: race(), phases: [phase] })), 'neutralised').forUs[0]!;
      expect(us.otherCarId).toEqual(unknown('notApplicable'));
      expect(us.gapBeforeMs).toEqual(unknown('notApplicable'));
      expect(us.gapAfterMs).toEqual(unknown('notApplicable'));
    });

    it('the other car retired (its car-status span) by the after moment: gapAfterMs notApplicable (it has no gap any more)', () => {
      const spans = status(5, [{ kind: 'retired', at: T + 1_000, detail: RETIRED }]);
      const us = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)], spans })), 'collision').forUs[0]!;
      expect(valueOf(us.gapBeforeMs)).toBe(700);
      expect(us.gapAfterMs).toEqual(unknown('notApplicable'));
    });
  });

  describe('forUs', () => {
    // The player collides with car 5 (P6, 0.7 s ahead) at T and loses 1.8 s in that mini-sector (below the time-loss
    // threshold). Five seconds later cars 7 and 8 are through: P7 → P9, 0.7 s → 2.5 s behind car 5.
    const miniSectors = race({ delays: [{ carId: PLAYER, lap: 5, segment: 24, ms: 1_800 }] });

    it('forUs: player P7 before, P9 five seconds later, gap to the car before and after', () => {
      const entry = only(run(viewOf({ miniSectors, events: [collision(6, 5)] })), 'collision');
      expect(entry.forUs).toHaveLength(1);
      const us = entry.forUs[0]!;
      expect(us.ourCarId).toBe(PLAYER);
      expect(us.otherCarId).toEqual(known(car(5), T));
      expect(valueOf(us.positionBefore)).toBe(7);
      expect(valueOf(us.positionAfter)).toBe(9);
      expect(valueOf(us.gapBeforeMs)).toBe(700);
      expect(valueOf(us.gapAfterMs)).toBe(2_500);
    });

    it('before five seconds have passed in the history, the after values are notReceived', () => {
      const early = until(miniSectors, T + AFTER_MS - 1_900);
      const us = only(run(viewOf({ miniSectors: early, events: [collision(6, 5)] })), 'collision').forUs[0]!;
      expect(valueOf(us.positionBefore)).toBe(7);
      expect(valueOf(us.gapBeforeMs)).toBe(700);
      expect(us.positionAfter).toEqual(unknown('notReceived'));
      expect(us.gapAfterMs).toEqual(unknown('notReceived'));
    });

    it('for a neighbour\'s incident, the gap is ours to that car (positive = we are behind it)', () => {
      const us = only(run(viewOf({ miniSectors: race(), spans: warned(5, [T]) })), 'warning').forUs[0]!;
      expect(valueOf(us.positionBefore)).toBe(7);
      // the car the gap is to: the neighbour of the incident, named so a label cannot name another car
      expect(us.otherCarId).toEqual(known(car(5), T));
      expect(valueOf(us.gapBeforeMs)).toBe(700);
      const behind = only(run(viewOf({ miniSectors: race(), spans: warned(8, [T]) })), 'warning').forUs[0]!;
      expect(valueOf(behind.gapBeforeMs)).toBe(-1_400);
    });
  });

  it('majorKinds config: warningMajor true makes warnings major', () => {
    const view = viewOf({ miniSectors: race(), spans: warned(7, [T]), config: { warningMajor: true } });
    expect(only(run(view), 'warning').severity).toBe('major');
    const noCollision = viewOf({ miniSectors: race(), events: [collision(6, 5)], config: { collisionMajor: false } });
    expect(only(run(noCollision), 'collision').severity).toBe('minor');
  });

  it('the feed is newest first and holds at most feedLength entries', () => {
    const feed = run(viewOf({ miniSectors: race(), spans: warned(7, [380_000, 390_000, 400_000]), config: { feedLength: 2 } }));
    expect(feed.map((e) => e.at)).toEqual([400_000, 390_000]);
    expect(INCIDENTS_CONFIG.read(viewOf({ miniSectors: [] })).feedLength).toBe(50);
  });

  describe('open spans (ruling 1): the session-phase span open in the situation (C20)', () => {
    const open = (start: number, kind: 'SC' | 'VSC' | 'red' = 'VSC', confirmed = true) => openNeutralisation({ kind, start, confirmed });

    it('the neutralised entry appears when the span opens and keeps its id when it closes', () => {
      const miniSectors = race();
      const start = 400_000;
      const running = viewOf({ miniSectors: until(miniSectors, 420_000), open: open(start), laps: leaderLaps(4) });
      const during = only(run(running), 'neutralised');
      expect(during).toMatchObject({ id: `neutralised::${start}`, at: start, lap: 5, severity: 'minor', carIds: [] });

      const closed = viewOf({
        miniSectors: until(miniSectors, 470_000),
        phases: [neutralisation({ kind: 'VSC', start, end: 460_000 })],
        laps: leaderLaps(5),
      });
      const after = runSteps([running, closed]);
      expect(only(after, 'neutralised').id).toBe(during.id);
      expect(after).toEqual(run(closed));
    });

    it('a slow mini-sector inside an open neutralisation or suspension is no timeLoss', () => {
      const miniSectors = until(race({ delays: [slow7(2_500)] }), SLOW_START + 20_000);
      for (const kind of ['SC', 'VSC', 'red'] as const) {
        const feed = run(viewOf({ miniSectors, open: open(SLOW_START - 10_000, kind) }));
        expect(feed.filter((e) => e.kind === 'timeLoss'), kind).toEqual([]);
      }
    });

    it('an open neutralisation still waiting for its confirmation counts: a neutralised entry, and no timeLoss inside it (ruling 2, C18)', () => {
      const miniSectors = until(race({ delays: [slow7(2_500)] }), SLOW_START + 20_000);
      const feed = run(viewOf({ miniSectors, open: open(SLOW_START - 1_000, 'SC', false) }));
      expect(feed.filter((e) => e.kind === 'neutralised').map((e) => e.at)).toEqual([SLOW_START - 1_000]);
      expect(feed.filter((e) => e.kind === 'timeLoss')).toEqual([]);
    });
  });

  // C18, C43 (Task 19, ruling 2): a `neutralised` span closed with `confirmed: false` is no neutralisation for any reader.
  describe('a neutralisation never confirmed', () => {
    const miniSectors = race({ delays: [slow7(2_500)] });
    const never = neutralisation({ kind: 'SC', start: SLOW_START - 1_000, end: SLOW_START + 2_000, confirmed: false });

    it('is no neutralised entry, and a slow mini-sector inside it is a timeLoss', () => {
      const feed = run(viewOf({ miniSectors, phases: [never] }));
      expect(feed.filter((e) => e.kind === 'neutralised')).toEqual([]);
      expect(only(feed, 'timeLoss')).toMatchObject({ at: SLOW_START, carIds: [car(7)] });
    });

    it('a pending neutralisation that closes unconfirmed: its entry goes and the timeLoss stands; update equals init (C31)', () => {
      const waiting = viewOf({ miniSectors: until(miniSectors, SLOW_START + 1_500), open: openNeutralisation({ kind: 'SC', start: SLOW_START - 1_000, confirmed: false }) });
      const dropped = viewOf({ miniSectors: until(miniSectors, SLOW_START + 20_000), phases: [never] });
      expect(run(waiting).filter((e) => e.kind === 'neutralised')).toHaveLength(1);
      const after = runSteps([waiting, dropped]);
      expect(after).toEqual(run(dropped));
      expect(after.filter((e) => e.kind === 'neutralised')).toEqual([]);
      expect(only(after, 'timeLoss').at).toBe(SLOW_START);
    });
  });

  describe('pit lane now (ruling 2): the car-location span open in the situation (C20)', () => {
    // History up to just after car 7's slow mini-sector; its newest crossings are the slow one's end and after.
    const miniSectors = until(race({ delays: [slow7(2_500)] }), SLOW_END + 500);

    it('no timeLoss for a car that is in the pit lane now, before its pit stop is recorded', () => {
      expect(ofKind(run(viewOf({ miniSectors, spans: location(7) })), 'timeLoss')).toHaveLength(1);
      // it entered the pit lane after the slow mini-sector's end crossing: no frame of the mini-sector is in the visit
      const entered = location(7, [{ kind: 'pitLane', at: SLOW_END + 300 }]);
      expect(ofKind(run(viewOf({ miniSectors, spans: entered })), 'timeLoss')).toEqual([]);
    });

    it('the pit lane now does not remove an older timeLoss of that car', () => {
      const later = until(race({ delays: [slow7(2_500)] }), boundaryAt(7, 7, 30));
      const entered = location(7, [{ kind: 'pitLane', at: boundaryAt(7, 7, 30) - 100 }]);
      expect(ofKind(run(viewOf({ miniSectors: later, spans: entered })), 'timeLoss')).toHaveLength(1);
    });
  });

  describe('detail: where, damage parts, warning count (I1), penalty kind', () => {
    /** A hit of car 7 that is a jump on its own: `part` rises from 0 by `deltaPct`. */
    const hit = (at: number, part: 'frontLeftWingPct' | 'floorPct' | 'rearWingPct', deltaPct: number) => dmg(at, part, 0, deltaPct);

    it('a collision carries the sector its first car was in, from the lap distance (2 428 m on the test track: S2)', () => {
      expect(TRACK.sector2StartM).toBe(1_600);
      const entry = only(run(viewOf({ miniSectors: race(), events: [collision(6, 5)] })), 'collision');
      expect(entry.where).toEqual({ sector: known(2, T) });
      // the player in mini-sector 40 of lap 5 (about 4 044 m): sector 3
      const late = boundaryAt(6, 5, 40) + 800;
      expect(only(run(viewOf({ miniSectors: race(), events: [collision(6, 5, late)] })), 'collision').where.sector).toEqual(known(3, late));
    });

    it('the lap distance is interpolated between the crossings, not the mini-sector start', () => {
      // The player's mini-sector 24 runs from 2 400 m to 2 500 m; with sector 2 from 2 430 m it is in sector 1 at T
      // (2 428 m) and in sector 2 300 ms later (2 444 m).
      const session = { sector2StartM: 2_430 };
      const at = (t: number) => only(run(viewOf({ miniSectors: race(), events: [collision(6, 5, t)], session })), 'collision').where.sector;
      expect(at(T)).toEqual(known(1, T));
      expect(at(T + 300)).toEqual(known(2, T + 300));
    });

    it('a timeLoss entry carries the sector of its start; a damage and a warning entry the sector of their car', () => {
      const loss = only(run(viewOf({ miniSectors: race({ delays: [slow7(2_500)] }) })), 'timeLoss');
      expect(loss.where.sector).toEqual(known(1, SLOW_START));
      const damage = only(run(viewOf({ miniSectors: race(), events: [hit(T, 'frontLeftWingPct', 12)] })), 'damage');
      expect(damage.where.sector).toEqual(known(2, T));
      expect(only(run(viewOf({ miniSectors: race(), spans: warned(7, [T]) })), 'warning').where.sector).toEqual(known(2, T));
    });

    it('no invented sector: notApplicable without a car, notReceived before a crossing or without the sector distances', () => {
      const sc = neutralisation({ kind: 'SC', start: T, end: T + 60_000 });
      expect(only(run(viewOf({ miniSectors: race(), phases: [sc] })), 'neutralised').where.sector).toEqual(unknown('notApplicable'));
      // our car (6) crosses its first boundary at 4 200 ms; the collision is at 1 000 ms
      const early = only(run(viewOf({ miniSectors: until(race(), 3_000), events: [collision(6, 5, 1_000)] })), 'collision');
      expect(early.where.sector).toEqual(unknown('notReceived'));
      const noSectors = viewOf({ miniSectors: race(), events: [collision(6, 5)], session: { sector2StartM: 0, sector3StartM: 0 } });
      expect(only(run(noSectors), 'collision').where.sector).toEqual(unknown('notReceived'));
    });

    it('a damage entry carries its parts and their rise, the biggest first; jumps of the car within the jump window are one entry', () => {
      const events = [hit(T, 'frontLeftWingPct', 12), hit(T + 500, 'floorPct', 20), hit(T + 3_000, 'rearWingPct', 8)];
      const feed = run(viewOf({ miniSectors: race(), events })).filter((e) => e.kind === 'damage');
      expect(feed.map((e) => e.id)).toEqual([`damage:7:${T + 3_000}`, `damage:7:${T}`]);
      expect(feed[1]!.damage).toEqual([
        { part: 'floorPct', deltaPct: 20 },
        { part: 'frontLeftWingPct', deltaPct: 12 },
      ]);
      expect(feed[0]!.damage).toEqual([{ part: 'rearWingPct', deltaPct: 8 }]);
    });

    it('a warning entry carries its count of the limit: the warned span\'s count, a penalty every warningsBeforePenalty', () => {
      // car 7: warnings 1 to 4 (a time penalty after the second), car 5: its first
      const spans = [...warned(7, [370_000, 380_000, 390_000, 400_000]), ...owes(7, [{ at: 385_000, totalMs: 5_000 }]), ...warned(5, [395_000])];
      const counts = (feed: IncidentEntry[], id: number) =>
        feed.filter((e) => e.kind === 'warning' && e.carIds[0] === car(id)).map((e) => e.warning);
      const feed = run(viewOf({ miniSectors: race(), spans }));
      expect(counts(feed, 7)).toEqual([1, 3, 2, 1].map((count) => ({ count, limit: 3 })));
      expect(counts(feed, 5)).toEqual([{ count: 1, limit: 3 }]);
      const two = run(viewOf({ miniSectors: race(), spans, alarmsConfig: { warningsBeforePenalty: 2 } }));
      expect(counts(two, 7)).toEqual([2, 1, 2, 1].map((count) => ({ count, limit: 2 })));
    });

    it('only penalty entries carry penalty', () => {
      const spans = [...warned(7, [T + 100]), ...owes(7, [{ at: T + 200, totalMs: 5_000 }])];
      const feed = run(viewOf({ miniSectors: race(), events: [collision(6, 5)], spans }));
      expect(feed.map((e) => e.kind).sort()).toEqual(['collision', 'penalty', 'warning']);
      for (const entry of feed) expect('penalty' in entry, entry.kind).toBe(entry.kind === 'penalty');
    });

    it('only damage entries carry damage and only warning entries carry warning', () => {
      const feed = run(viewOf({ miniSectors: race(), events: [collision(6, 5)], spans: owes(7, [{ at: T + 100, totalMs: 5_000 }]) }));
      expect(feed.map((e) => e.kind).sort()).toEqual(['collision', 'penalty']);
      for (const entry of feed) {
        expect('damage' in entry, entry.kind).toBe(false);
        expect('warning' in entry, entry.kind).toBe(false);
      }
    });
  });

  describe('time loss merged into a collision or damage (ruling 4)', () => {
    const miniSectors = race({ delays: [slow7(3_000)] });

    it('a timeLoss within 5 s of a collision of the same car sets the collision\'s timeLostMs, no second entry', () => {
      // The collision is reported 2 s before the slow mini-sector starts.
      const feed = run(viewOf({ miniSectors, events: [collision(7, 8, SLOW_START - 2_000)] }));
      expect(feed.map((e) => e.kind)).toEqual(['collision']);
      expect(valueOf(feed[0]!.timeLostMs)).toBe(3_000);
    });

    it('a timeLoss of the second car of a collision (otherCarId) merges into that collision entry', () => {
      const feed = run(viewOf({ miniSectors, events: [collision(8, 7, SLOW_START - 2_000)] }));
      expect(feed.map((e) => e.kind)).toEqual(['collision']);
      expect(feed[0]!.carIds).toEqual([car(8), car(7)]);
      expect(valueOf(feed[0]!.timeLostMs)).toBe(3_000);
    });

    it('a timeLoss near a warning or penalty of the same car stays its own entry; the penalty has no time lost', () => {
      const near = SLOW_START - 2_000;
      const cases = [
        ['warning', warned(7, [near])],
        ['penalty', owes(7, [{ at: near, totalMs: 5_000 }])],
      ] as const;
      for (const [kind, spans] of cases) {
        const feed = run(viewOf({ miniSectors, spans: [...spans] }));
        expect(feed.map((e) => e.kind).sort()).toEqual([kind, 'timeLoss'].sort());
        expect(feed.find((e) => e.kind !== 'timeLoss')!.timeLostMs).toEqual(unknown('notApplicable'));
      }
    });

    it('a timeLoss within 5 s of a damage jump of the same car sets the damage entry\'s timeLostMs', () => {
      const feed = run(viewOf({ miniSectors, events: [dmg(SLOW_START + 1_000, 'floorPct', 0, 30)] }));
      expect(feed.map((e) => e.kind)).toEqual(['damage']);
      expect(valueOf(feed[0]!.timeLostMs)).toBe(3_000);
    });

    it('a timeLoss more than 5 s from the collision, or of another car, stays its own entry', () => {
      const far = run(viewOf({ miniSectors, events: [collision(7, 8, SLOW_START - 8_000)] }));
      expect(far.map((e) => e.kind).sort()).toEqual(['collision', 'timeLoss']);
      const other = run(viewOf({ miniSectors, events: [collision(8, 9, SLOW_START - 2_000)] }));
      expect(other.map((e) => e.kind).sort()).toEqual(['collision', 'timeLoss']);
    });
  });

  describe('a repair (a fall of the part) changes nothing in the feed: it is a log (RA1)', () => {
    const miniSectors = race({ delays: [slow7(3_000)] });
    const HIT = SLOW_START + 1_000;
    const hitEvents = [dmg(HIT, 'frontRightWingPct', 0, 37)];
    /** The same hit, then a wing change about a lap later. */
    const repaired = [...hitEvents, dmg(HIT + 90_000, 'frontRightWingPct', 37, 0)];

    it('a hit with a merged time loss, then a wing change: the damage entry and its merged loss stay; no timeLoss entry appears', () => {
      const feed = run(viewOf({ miniSectors, events: repaired }));
      expect(feed.map((e) => e.kind)).toEqual(['damage']);
      const entry = feed[0]!;
      expect(entry).toMatchObject({ id: `damage:7:${HIT}`, at: HIT, carIds: [car(7)] });
      expect(entry.damage).toEqual([{ part: 'frontRightWingPct', deltaPct: 37 }]);
      expect(valueOf(entry.timeLostMs)).toBe(3_000);
      expect(feed).toEqual(run(viewOf({ miniSectors, events: hitEvents })));
    });

    it("the user's case: three hits on the front-right wing, each followed by a change: three damage entries", () => {
      const events = [
        dmg(200_000, 'frontRightWingPct', 0, 37),
        dmg(250_000, 'frontRightWingPct', 37, 0),
        dmg(300_000, 'frontRightWingPct', 0, 33),
        dmg(350_000, 'frontRightWingPct', 33, 0),
        dmg(450_000, 'frontRightWingPct', 0, 30),
        dmg(500_000, 'frontRightWingPct', 30, 0),
      ];
      const feed = run(viewOf({ miniSectors: race(), events })).filter((e) => e.kind === 'damage');
      expect(feed.map((e) => [e.id, e.damage])).toEqual([
        [`damage:7:450000`, [{ part: 'frontRightWingPct', deltaPct: 30 }]],
        [`damage:7:300000`, [{ part: 'frontRightWingPct', deltaPct: 33 }]],
        [`damage:7:200000`, [{ part: 'frontRightWingPct', deltaPct: 37 }]],
      ]);
    });

    it('a hit after the wing change is a new entry with its rise from the repaired value; the first one stays', () => {
      const events = [...repaired, dmg(HIT + 200_000, 'frontRightWingPct', 0, 12)];
      // no slow run here: with the 3 s loss car 7 drops out of our neighbourhood before the second hit
      const feed = run(viewOf({ miniSectors: race(), events })).filter((e) => e.kind === 'damage');
      expect(feed.map((e) => [e.at, e.damage])).toEqual([
        [HIT + 200_000, [{ part: 'frontRightWingPct', deltaPct: 12 }]],
        [HIT, [{ part: 'frontRightWingPct', deltaPct: 37 }]],
      ]);
    });

    // in time order, as the history appends them
    const events = [...repaired, dmg(HIT + 200_000, 'frontRightWingPct', 0, 12), collision(6, 5)].sort((a, b) => a.at - b.at);
    // Car 7's laps: 90 s, then 93 s for the lap of the hit (lap 5), then 91 s.
    const laps = lapsOf7(8, (n) => (n <= 4 ? PACE_MS : n === 5 ? PACE_MS + 3_000 : PACE_MS + 1_000));
    // no slow run: car 7 stays in our neighbourhood for the second hit
    const steady = race();
    const at = (t: number) => viewOf({ miniSectors: until(steady, t), events: until(events, t), laps: laps.filter((l) => l.completedAt <= t) });
    const times = [...new Set([...events.map((e) => e.at), ...laps.map((l) => l.completedAt), 300_000, 700_000])].sort((a, b) => a - b);

    it('incremental equals from scratch through the hit, the repair and the next hit, after every event and every lap', () => {
      const views = [at(0), ...times.map(at)];
      for (let i = 1; i < views.length; i++) {
        expect(runSteps(views.slice(0, i + 1)), `at ${times[i - 1]}`).toEqual(run(views[i]!));
      }
      const feed = run(views[views.length - 1]!).filter((e) => e.kind === 'damage');
      expect(feed.map((e) => e.at)).toEqual([HIT + 200_000, HIT]);
    });

    it('a flashback to between the hit and the repair equals a fresh run, and the entry is there', () => {
      const full = at(720_000);
      const cut = at(HIT + 60_000);
      const acc = incidents.update(incidents.init(at(0)), deltaOf(at(0), full), full);
      const after = incidents.output(incidents.update(acc, deltaOf(full, cut, true), cut));
      expect(after).toEqual(run(cut));
      expect(after.filter((e) => e.kind === 'damage').map((e) => e.at)).toEqual([HIT]);
    });
  });

  describe('incremental', () => {
    const miniSectors = race({ delays: [slow7(2_500), { carId: PLAYER, lap: 5, segment: 24, ms: 1_800 }] });
    const events = [collision(6, 5), collision(0, 1, 430_000)];
    // car 7 warned at 420 s, car 8 retires at 450 s, car 5 takes a drive-through at 460 s and serves it at 520 s
    const spans = [
      ...warned(7, [420_000]),
      ...status(8, [{ kind: 'retired', at: 450_000, detail: RETIRED }]),
      ...owes(5, [{ at: 460_000, dt: 1 }, { at: 520_000 }]),
      ...location(5, [{ kind: 'pitLane', at: 515_000 }, { kind: 'track', at: 540_000 }]),
    ];
    const at = (t: number) => viewOf({ miniSectors: until(miniSectors, t), events: until(events, t), spans: spansUntil(spans, t) });

    it('update in steps equals init over the whole history', () => {
      const steps = [300_000, 383_000, 386_000, 407_900, 410_000, 412_000, 413_000, 425_000, 455_000, 465_000, 518_000, 530_000, 800_000].map(at);
      const final = run(steps[steps.length - 1]!);
      expect(runSteps(steps)).toEqual(final);
      expect(final.map((e) => e.kind).sort()).toEqual(['collision', 'penalty', 'retirement', 'timeLoss', 'warning']);
    });

    it('flashback equals fresh run', () => {
      const full = at(800_000);
      const truncatedView = at(400_000);
      const acc = incidents.update(incidents.init(at(500_000)), deltaOf(at(500_000), full), full);
      const truncated = incidents.update(acc, deltaOf(full, truncatedView, true), truncatedView);
      expect(incidents.output(truncated)).toEqual(run(truncatedView));
    });

    it('no duplicate entry after a flashback over the incident', () => {
      const first = viewOf({ miniSectors, events: [collision(6, 5)] });
      const cut = viewOf({ miniSectors: until(miniSectors, 400_000), events: [] });
      // After the flashback the player drives the same stretch again and collides 1.6 s later.
      const again = viewOf({ miniSectors, events: [collision(6, 5, T + 1_600)] });

      let acc = incidents.init(first);
      acc = incidents.update(acc, deltaOf(first, cut, true), cut);
      acc = incidents.update(acc, deltaOf(cut, again), again);
      const feed = incidents.output(acc);

      const collisions = feed.filter((e) => e.kind === 'collision');
      expect(collisions.map((e) => e.at)).toEqual([T + 1_600]);
      expect(feed).toEqual(run(again));
    });
  });
});

// The behaviour table (C43, C44): one row per kind of every sub-machine `incidents` reads; one test per row, each on a
// builder view with the span set.
describe('incidents behaves per situation by its behaviour table (C44)', () => {
  it('exports INCIDENTS_BEHAVIOUR from its index: a row for every kind of every sub-machine it reads, and no other', () => {
    const table = (unit as Record<string, unknown>)[behaviourExport('incidents')] as BehaviourTable<unknown> | undefined;
    expect(table, 'INCIDENTS_BEHAVIOUR').toBeDefined();
    expect(Object.keys(table ?? {}).sort()).toEqual([...MACHINES].sort());
    for (const machine of MACHINES) {
      const kinds = SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];
      expect(Object.keys(table?.[machine] ?? {}).sort(), machine).toEqual([...kinds].sort());
    }
  });

  // C14: the feed is the race's; in any other weekend phase it holds nothing.
  describe('weekend-phase', () => {
    const PHASES: Record<'practice' | 'qualifying' | 'none' | 'pending', WeekendPhase> = {
      practice: { kind: 'practice', format: 'practice', segment: 1 },
      qualifying: { kind: 'qualifying', format: 'grandPrix', segment: 1 },
      none: { kind: 'none' },
      pending: { kind: 'pending' },
    };
    const feedIn = (weekendPhase: WeekendPhase, session = {}) => run(viewOf({ miniSectors: race(), events: [collision(6, 5)], weekendPhase, session }));

    it('race: the feed holds the incidents of the race, a grand prix or a sprint', () => {
      expect(feedIn({ kind: 'race', format: 'grandPrix' }).map((e) => e.id)).toEqual([`collision:6-5:${T}`]);
      expect(feedIn({ kind: 'race', format: 'sprint' }).map((e) => e.id)).toEqual([`collision:6-5:${T}`]);
    });

    it.each(['practice', 'qualifying'] as const)('%s: the feed is empty (race only)', (phase) => {
      expect(feedIn(PHASES[phase])).toEqual([]);
    });

    it('none: the feed is empty (notApplicable, C14)', () => {
      expect(feedIn(PHASES.none)).toEqual([]);
    });

    it('pending (no weekend phase yet, no span): the feed is empty, as on the grid (C14)', () => {
      expect(feedIn(PHASES.pending)).toEqual([]);
    });

    it('the weekend phase decides, not the session type', () => {
      expect(feedIn(PHASES.practice, { kind: 'race' })).toEqual([]);
      expect(feedIn({ kind: 'race', format: 'grandPrix' }, { kind: 'practice' })).toHaveLength(1);
    });
  });

  describe('session-phase-race', () => {
    const miniSectors = race({ delays: [slow7(2_500)] });

    it.each(['SC', 'VSC', 'red'] as const)('neutralised and suspended (%s): a neutralised entry, and no timeLoss inside it', (kind) => {
      const span = neutralisation({ kind, start: SLOW_START - 10_000, end: SLOW_START + 30_000 });
      const feed = run(viewOf({ miniSectors, phases: [span], laps: leaderLaps(LAPS) }));
      expect(only(feed, 'neutralised')).toMatchObject({ at: SLOW_START - 10_000, carIds: [] });
      expect(ofKind(feed, 'timeLoss')).toEqual([]);
    });

    it.each(['grid', 'formation', 'startLights', 'racing', 'finished', 'postSession'])('%s: no entry of its own', (kind) => {
      const spans = chain('session-phase-race', undefined, [{ kind, at: SLOW_START - 10_000 }], SLOW_START + 30_000);
      const feed = run(viewOf({ miniSectors: race(), events: [collision(6, 5)], spans }));
      expect(feed.map((e) => e.kind)).toEqual(['collision']);
    });

    it('racing: a slow mini-sector inside it is a timeLoss', () => {
      const spans = chain('session-phase-race', undefined, [{ kind: 'racing', at: 1_000 }]);
      expect(only(run(viewOf({ miniSectors, spans })), 'timeLoss').at).toBe(SLOW_START);
    });

    it('a mini-sector shares a frame with a neutralisation by frame, not by time (C26)', () => {
      // the SC opens on the frame before car 7's crossing (5, 11) that ends the slow mini-sector, at that crossing's
      // race-clock time: several frames share one time, so the times touch but the frames overlap
      const sc = neutralisation({ kind: 'SC', start: SLOW_END, end: SLOW_END + 30_000, startFrame: SLOW_END - 1 });
      expect(ofKind(run(viewOf({ miniSectors, phases: [sc] })), 'timeLoss')).toEqual([]);
    });
  });

  // A session-phase sub-machine of another weekend phase: the feed is the race's, so none of its kinds gives an entry.
  describe.each([
    ['session-phase-qualifying', { kind: 'qualifying', format: 'grandPrix', segment: 1 }],
    ['session-phase-practice', { kind: 'practice', format: 'practice', segment: 1 }],
  ] as const)('%s', (machine, weekendPhase) => {
    it.each(['grid', 'running', 'suspended', 'finished', 'postSession'])('%s: no entry (the feed is race only)', (kind) => {
      const detail = kind === 'suspended' ? { restart: unknown('notReceived') } : undefined;
      const spans = chain(machine, undefined, [{ kind, at: T - 10_000, detail }], T + 30_000);
      expect(run(viewOf({ miniSectors: race({ delays: [slow7(2_500)] }), events: [collision(6, 5)], spans, weekendPhase }))).toEqual([]);
    });
  });

  describe('car-location', () => {
    const miniSectors = race({ delays: [slow7(2_500)] });
    const losses = (spans: ReturnType<typeof location>) => ofKind(run(viewOf({ miniSectors, spans })), 'timeLoss').map((e) => e.at);

    it('track: a slow mini-sector on track is a timeLoss', () => {
      expect(losses(location(7))).toEqual([SLOW_START]);
    });

    it('pitLane: a slow mini-sector that shares a frame with a pit visit (closed or open) is no timeLoss', () => {
      expect(losses(location(7, [{ kind: 'pitLane', at: SLOW_START + 1_000 }, { kind: 'track', at: SLOW_START + 20_000 }]))).toEqual([]);
      const now = until(miniSectors, SLOW_START + 20_000);
      expect(ofKind(run(viewOf({ miniSectors: now, spans: location(7, [{ kind: 'pitLane', at: SLOW_START + 1_000 }]) })), 'timeLoss')).toEqual([]);
    });

    it('garage: a slow mini-sector that shares a frame with a spell in the garage is no timeLoss', () => {
      expect(losses(location(7, [{ kind: 'garage', at: SLOW_START + 1_000 }, { kind: 'track', at: SLOW_START + 20_000 }]))).toEqual([]);
    });

    it("another car's pit visit excludes nothing of car 7", () => {
      expect(losses([...location(7), ...location(6, [{ kind: 'pitLane', at: SLOW_START + 1_000 }, { kind: 'track', at: SLOW_START + 20_000 }])])).toEqual([SLOW_START]);
    });

    // C26 (Task 19 review): a pit visit is matched to a mini-sector by frames, as a neutralisation is, never by times.
    describe('a pit visit overlaps by frame, not by time, as a neutralisation does (C26)', () => {
      it('a visit that opens on the frame before the crossing that ends the slow mini-sector, at its time, overlaps it', () => {
        // the pit stop record's times touch the mini-sector's end and do not overlap it; the frames do
        const spans = location(7, [{ kind: 'pitLane', at: SLOW_END, frame: SLOW_END - 1 }, { kind: 'track', at: SLOW_END + 20_000 }]);
        const pitStops = [pitStop(car(7), 5, SLOW_END, SLOW_END + 20_000)];
        expect(ofKind(run(viewOf({ miniSectors, spans, pitStops })), 'timeLoss')).toEqual([]);
      });

      it('a visit that closes on the frame after the crossing that starts the slow mini-sector, at its time, overlaps it', () => {
        const spans = location(7, [{ kind: 'pitLane', at: SLOW_START - 20_000 }, { kind: 'track', at: SLOW_START, frame: SLOW_START + 1 }]);
        const pitStops = [pitStop(car(7), 5, SLOW_START - 20_000, SLOW_START)];
        expect(ofKind(run(viewOf({ miniSectors, spans, pitStops })), 'timeLoss')).toEqual([]);
      });

      it("a visit that opens on the crossing's own frame does not overlap the mini-sector that ends there", () => {
        expect(losses(location(7, [{ kind: 'pitLane', at: SLOW_END }, { kind: 'track', at: SLOW_END + 20_000 }]))).toEqual([SLOW_START]);
      });

      it("a pit stop record alone excludes nothing: the visit is the car's car-location span, with its frames", () => {
        const pitStops = [pitStop(car(7), 5, SLOW_START - 1_000, SLOW_START + 20_000)];
        expect(ofKind(run(viewOf({ miniSectors, spans: location(7), pitStops })), 'timeLoss').map((e) => e.at)).toEqual([SLOW_START]);
      });
    });
  });

  describe('car-status', () => {
    const feedWith = (spans: ReturnType<typeof status>) => run(viewOf({ miniSectors: race(), spans }));

    it('competing: no entry', () => {
      expect(feedWith([...status(7), ...status(8)])).toEqual([]);
    });

    it('retired: a major retirement entry when the span opens, with no time lost', () => {
      const entry = only(feedWith(status(8, [{ kind: 'retired', at: T, detail: RETIRED }])), 'retirement');
      expect(entry).toMatchObject({ id: `retirement:8:${T}`, at: T, lap: 5, severity: 'major', carIds: [car(8)] });
      expect(entry.timeLostMs).toEqual(unknown('notApplicable'));
    });

    it('retired since the engine joined the session (joinedAt): no entry, its retirement was not seen', () => {
      expect(feedWith(chain('car-status', 8, [{ kind: 'retired', at: T, detail: RETIRED, joinedAt: true }]))).toEqual([]);
    });

    it('disqualified: a penalty entry of kind disqualified when the span opens', () => {
      const entry = only(feedWith(status(7, [{ kind: 'disqualified', at: T }])), 'penalty');
      expect(entry).toMatchObject({ id: `penalty:7:${T}`, at: T, severity: 'minor', carIds: [car(7)] });
      expect(entry.penalty).toEqual({ kind: 'disqualified' });
    });

    it('a disqualification closed unconfirmed is no entry (C18)', () => {
      expect(feedWith(status(7, [{ kind: 'disqualified', at: T, confirmed: false }, { kind: 'competing', at: T + 1_500 }]))).toEqual([]);
    });

    it('absent: no entry', () => {
      expect(feedWith(status(8, [{ kind: 'absent', at: T }]))).toEqual([]);
    });

  });

  describe('penalties', () => {
    const penalties = (spans: ReturnType<typeof owes>) => ofKind(run(viewOf({ miniSectors: race(), spans })), 'penalty').map((e) => [e.at, e.penalty]);

    it('clear: no entry; a served penalty (back to clear) adds none', () => {
      expect(penalties(owes(7, []))).toEqual([]);
      expect(penalties(owes(7, [{ at: T - 30_000, dt: 1 }, { at: T }]))).toEqual([[T - 30_000, { kind: 'driveThrough' }]]);
    });

    it('timePenalty: a time penalty entry with its time, the rise of the time penalties in total', () => {
      expect(penalties(owes(7, [{ at: T, totalMs: 5_000 }]))).toEqual([[T, { kind: 'time', timeMs: 5_000 }]]);
      expect(penalties(owes(7, [{ at: T - 20_000, totalMs: 5_000 }, { at: T, totalMs: 15_000 }]))).toEqual([
        [T, { kind: 'time', timeMs: 10_000 }],
        [T - 20_000, { kind: 'time', timeMs: 5_000 }],
      ]);
    });

    it('driveThroughPending: a drive-through entry, with no time', () => {
      expect(penalties(owes(7, [{ at: T, dt: 1 }]))).toEqual([[T, { kind: 'driveThrough' }]]);
    });

    it('stopGoPending: a stop-go entry, with no time', () => {
      expect(penalties(owes(7, [{ at: T, sg: 1 }]))).toEqual([[T, { kind: 'stopGo' }]]);
    });

    it('a drive-through served while a time penalty stands adds no entry', () => {
      const spans = owes(7, [{ at: T - 20_000, totalMs: 5_000 }, { at: T - 10_000, dt: 1, totalMs: 5_000 }, { at: T, totalMs: 5_000 }]);
      expect(penalties(spans)).toEqual([
        [T - 10_000, { kind: 'driveThrough' }],
        [T - 20_000, { kind: 'time', timeMs: 5_000 }],
      ]);
    });

    it('a time penalty given while a drive-through is pending is a time penalty entry', () => {
      const spans = owes(7, [{ at: T - 10_000, dt: 1 }, { at: T, dt: 1, totalMs: 5_000 }]);
      expect(penalties(spans)).toEqual([
        [T, { kind: 'time', timeMs: 5_000 }],
        [T - 10_000, { kind: 'driveThrough' }],
      ]);
    });

    it('owed since the engine joined the session (joinedAt): no entry, the penalty was not seen given', () => {
      expect(penalties(chain('penalties', 7, [owedStep({ at: T, totalMs: 5_000, joinedAt: true })]))).toEqual([]);
    });

  });

  describe('warnings', () => {
    it('noWarning: no entry', () => {
      expect(run(viewOf({ miniSectors: race(), spans: warned(7, []) }))).toEqual([]);
    });

    it("warned: a warning entry with the span's count of the limit", () => {
      const entry = only(run(viewOf({ miniSectors: race(), spans: warned(7, [T - 10_000, T]) })).filter((e) => e.at === T), 'warning');
      expect(entry).toMatchObject({ id: `warning:7:${T}`, at: T, carIds: [car(7)], warning: { count: 2, limit: 3 } });
    });

    it('warned since the engine joined the session (joinedAt): no entry, the warning was not seen given', () => {
      const spans = chain('warnings', 7, [{ kind: 'warned', at: T, detail: { count: 2, infringement: unknown('notReceived') }, joinedAt: true }]);
      expect(run(viewOf({ miniSectors: race(), spans }))).toEqual([]);
    });

  });
});
