import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type CarId, type IncidentEntry, type Known, type RaceEvent } from '@pitwall/domain';
import { carState, event, flagPhase, lap } from '../../../../test-support/builders/index.ts';
import { incidentsCalculator } from '../../src/incidents/calculator.ts';
import { INCIDENTS, INCIDENTS_CONFIG } from '../../src/incidents/index.ts';
import { DAMAGE } from '../../src/damage/index.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';
import {
  boundaryAt,
  damageState,
  deltaOf,
  PACE_MS,
  SEGMENT_MS,
  pitStop,
  PLAYER,
  race,
  run,
  runSteps,
  startOf,
  TRACK,
  until,
  viewOf,
  type Delay,
} from './race.ts';

const car = carId;
/** Mid-lap 5 of the player: between its boundaries (5, 24) at 407 400 and (5, 25) at 409 200. */
const T = 407_900;
const AFTER_MS = 5_000;

const valueOf = <T>(k: Known<T>): T | undefined => (k.known ? k.value : undefined);

const collision = (a: number, b: number, at = T): RaceEvent => event({ kind: 'collision', at, carId: car(a), otherCarId: car(b) });
const penalty = (id: number, penaltyType: number, at = T): RaceEvent =>
  event({ kind: 'penalty', at, carId: car(id), params: { penaltyType, infringementType: 7, lap: 5, placesGained: 0 } });

/** The F1 25 `penaltyType` codes (Event packet, "Penalty types" appendix of the data-output spec). */
const WARNING = 5;
const TIME_PENALTY = 4;

const only = (feed: IncidentEntry[], kind: IncidentEntry['kind']): IncidentEntry => {
  const entries = feed.filter((e) => e.kind === kind);
  expect(entries, `entries of kind ${kind}`).toHaveLength(1);
  return entries[0]!;
};

/** A slow mini-sector of car 7 on lap 5, segment 10 (it enters it at boundary (5, 10)). */
const slow7 = (ms: number, segment = 10): Delay => ({ carId: car(7), lap: 5, segment, ms });
const SLOW_START = boundaryAt(7, 5, 10);

describe('incidents calculator', () => {
  it('is incremental over events, flag phases, mini-sectors, pit stops and laps, and reads damage', () => {
    expect(incidentsCalculator.id).toBe(INCIDENTS);
    expect(incidentsCalculator.kind).toBe('incremental');
    expect(incidentsCalculator.reads).toEqual(
      expect.arrayContaining(['events', 'flagPhases', 'miniSectors', 'pitStops', 'laps', { calculator: DAMAGE }]),
    );
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
    const live: GapsOutput = {
      intervals: [],
      lineTimes: {},
      recent: {},
      neighbourhood: [{ ourCarId: PLAYER, carIds: [car(0), car(1)] }],
      raceStartAt: known(0, 0),
    };
    expect(run(viewOf({ miniSectors: race(), events: [collision(0, 1)], gaps: live }))).toEqual([]);
  });

  it('a retirement of a neighbour is a major entry', () => {
    const entry = only(run(viewOf({ miniSectors: race(), events: [event({ kind: 'retirement', at: T, carId: car(8), params: { reason: 'retired' } })] })), 'retirement');
    expect(entry).toMatchObject({ id: `retirement:8:${T}`, severity: 'major', carIds: [car(8)], lap: 5 });
  });

  it('a warning penalty event of a neighbour is a minor warning entry', () => {
    const entry = only(run(viewOf({ miniSectors: race(), events: [penalty(7, WARNING)] })), 'warning');
    expect(entry).toMatchObject({ id: `warning:7:${T}`, at: T, severity: 'minor', carIds: [car(7)] });
    expect(entry.timeLostMs).toEqual(unknown('notApplicable'));
  });

  it('any other penalty type is a minor penalty entry', () => {
    const entry = only(run(viewOf({ miniSectors: race(), events: [penalty(7, TIME_PENALTY)] })), 'penalty');
    expect(entry).toMatchObject({ id: `penalty:7:${T}`, severity: 'minor', carIds: [car(7)] });
    expect(entry.timeLostMs).toEqual(unknown('notApplicable'));
  });

  it('a damage jump of a neighbour is a major damage entry; its time lost is the jump\'s measured loss', () => {
    const jump = { at: T, lap: 5, parts: ['frontLeftWingPct' as const], deltaPct: 20, lossMsPerLap: known(800, 500_000) };
    const entry = only(run(viewOf({ miniSectors: race(), damage: { [car(7)]: damageState([jump]) } as Record<CarId, ReturnType<typeof damageState>> })), 'damage');
    expect(entry).toMatchObject({ id: `damage:7:${T}`, at: T, lap: 5, severity: 'major', carIds: [car(7)] });
    expect(valueOf(entry.timeLostMs)).toBe(800);
  });

  it('an SC phase start is a minor neutralised entry with no cars', () => {
    const start = 400_000;
    const entry = only(run(viewOf({ miniSectors: race(), flagPhases: [flagPhase({ kind: 'SC', start, end: 460_000, startLeaderLap: 5, endLeaderLap: 6 })] })), 'neutralised');
    expect(entry).toMatchObject({ id: `neutralised::${start}`, at: start, lap: 5, severity: 'minor', carIds: [] });
    expect(entry.timeLostMs).toEqual(unknown('notApplicable'));
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

    it('a slow mini-sector inside an SC phase or a pit stop is no timeLoss', () => {
      const miniSectors = race({ delays: [slow7(2_500)] });
      const sc = flagPhase({ kind: 'SC', start: SLOW_START - 10_000, end: SLOW_START + 30_000, startLeaderLap: 5, endLeaderLap: 6 });
      const underSc = run(viewOf({ miniSectors, flagPhases: [sc] }));
      expect(underSc.filter((e) => e.kind === 'timeLoss')).toEqual([]);

      const stop = pitStop(car(7), 5, SLOW_START - 1_000, SLOW_START + 20_000);
      expect(run(viewOf({ miniSectors, pitStops: [stop] })).filter((e) => e.kind === 'timeLoss')).toEqual([]);
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
      const phase = flagPhase({ kind: 'SC', start: T, end: T + 60_000, startLeaderLap: 5, endLeaderLap: 6 });
      const us = only(run(viewOf({ miniSectors: race(), flagPhases: [phase] })), 'neutralised').forUs[0]!;
      expect(us.otherCarId).toEqual(unknown('notApplicable'));
      expect(us.gapBeforeMs).toEqual(unknown('notApplicable'));
      expect(us.gapAfterMs).toEqual(unknown('notApplicable'));
    });

    it('the other car retired by the after moment: gapAfterMs notApplicable (it has no gap any more)', () => {
      const events = [collision(6, 5), event({ kind: 'retirement', at: T + 1_000, carId: car(5), params: { reason: 'retired' } })];
      const us = only(run(viewOf({ miniSectors: race(), events })), 'collision').forUs[0]!;
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
      const us = only(run(viewOf({ miniSectors: race(), events: [penalty(5, WARNING)] })), 'warning').forUs[0]!;
      expect(valueOf(us.positionBefore)).toBe(7);
      // the car the gap is to: the neighbour of the incident, named so a label cannot name another car
      expect(us.otherCarId).toEqual(known(car(5), T));
      expect(valueOf(us.gapBeforeMs)).toBe(700);
      const behind = only(run(viewOf({ miniSectors: race(), events: [penalty(8, WARNING)] })), 'warning').forUs[0]!;
      expect(valueOf(behind.gapBeforeMs)).toBe(-1_400);
    });
  });

  it('majorKinds config: warningMajor true makes warnings major', () => {
    const view = viewOf({ miniSectors: race(), events: [penalty(7, WARNING)], config: { warningMajor: true } });
    expect(only(run(view), 'warning').severity).toBe('major');
    const noCollision = viewOf({ miniSectors: race(), events: [collision(6, 5)], config: { collisionMajor: false } });
    expect(only(run(noCollision), 'collision').severity).toBe('minor');
  });

  it('the feed is newest first and holds at most feedLength entries', () => {
    const events = [380_000, 390_000, 400_000].map((at) => penalty(7, WARNING, at));
    const feed = run(viewOf({ miniSectors: race(), events, config: { feedLength: 2 } }));
    expect(feed.map((e) => e.at)).toEqual([400_000, 390_000]);
    expect(INCIDENTS_CONFIG.read(viewOf({ miniSectors: [] })).feedLength).toBe(50);
  });

  it('outside a race the feed is empty', () => {
    expect(run(viewOf({ miniSectors: race(), events: [collision(6, 5)], kind: 'practice' }))).toEqual([]);
  });

  describe('open phases (ruling 1)', () => {
    const open = (start: number, kind: 'SC' | 'VSC' | 'red' = 'VSC') => ({ kind, start, startLeaderLap: 5, scPhases: [] });

    it('the neutralised entry appears when the phase starts and keeps its id when it closes', () => {
      const miniSectors = race();
      const start = 400_000;
      const running = viewOf({ miniSectors: until(miniSectors, 420_000), activeFlagPhase: open(start) });
      const during = only(run(running), 'neutralised');
      expect(during).toMatchObject({ id: `neutralised::${start}`, at: start, lap: 5, severity: 'minor', carIds: [] });

      const closed = viewOf({
        miniSectors: until(miniSectors, 470_000),
        flagPhases: [flagPhase({ kind: 'VSC', start, end: 460_000, startLeaderLap: 5, endLeaderLap: 6 })],
      });
      const after = runSteps([running, closed]);
      expect(only(after, 'neutralised').id).toBe(during.id);
      expect(after).toEqual(run(closed));
    });

    it('a slow mini-sector inside an open neutralised phase is no timeLoss', () => {
      const miniSectors = until(race({ delays: [slow7(2_500)] }), SLOW_START + 20_000);
      for (const kind of ['SC', 'VSC', 'red'] as const) {
        const feed = run(viewOf({ miniSectors, activeFlagPhase: open(SLOW_START - 10_000, kind) }));
        expect(feed.filter((e) => e.kind === 'timeLoss'), kind).toEqual([]);
      }
    });
  });

  describe('pit lane (ruling 2)', () => {
    // History up to just after car 7's slow mini-sector; its newest crossings are the slow one's end and after.
    const miniSectors = until(race({ delays: [slow7(2_500)] }), SLOW_START + SEGMENT_MS + 2_500 + 500);
    const car7 = (pitStatus: 'none' | 'pitting' | 'inPitArea') => [carState({ id: car(7), timing: { pitStatus } })];

    it('no timeLoss for a car that is in the pit lane now, before its pit stop is recorded', () => {
      expect(run(viewOf({ miniSectors, cars: car7('none') })).filter((e) => e.kind === 'timeLoss')).toHaveLength(1);
      for (const status of ['pitting', 'inPitArea'] as const) {
        expect(run(viewOf({ miniSectors, cars: car7(status) })).filter((e) => e.kind === 'timeLoss'), status).toEqual([]);
      }
    });

    it('the live pit status does not remove an older timeLoss of that car', () => {
      const later = until(race({ delays: [slow7(2_500)] }), boundaryAt(7, 7, 30));
      expect(run(viewOf({ miniSectors: later, cars: car7('pitting') })).filter((e) => e.kind === 'timeLoss')).toHaveLength(1);
    });
  });

  describe('penalty types (ruling 3)', () => {
    it.each([0, 1, 2, 4, 6, 9])('penaltyType %i is a penalty entry', (type) => {
      expect(run(viewOf({ miniSectors: race(), events: [penalty(7, type)] })).map((e) => e.kind)).toEqual(['penalty']);
    });

    it('penaltyType 5 is a warning entry', () => {
      expect(run(viewOf({ miniSectors: race(), events: [penalty(7, WARNING)] })).map((e) => e.kind)).toEqual(['warning']);
    });

    it.each([3, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17])('penaltyType %i is ignored', (type) => {
      expect(run(viewOf({ miniSectors: race(), events: [penalty(7, type)] }))).toEqual([]);
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
      for (const type of [WARNING, TIME_PENALTY]) {
        const feed = run(viewOf({ miniSectors, events: [penalty(7, type, SLOW_START - 2_000)] }));
        expect(feed.map((e) => e.kind).sort()).toEqual([type === WARNING ? 'warning' : 'penalty', 'timeLoss'].sort());
        expect(feed.find((e) => e.kind !== 'timeLoss')!.timeLostMs).toEqual(unknown('notApplicable'));
      }
    });

    it('a timeLoss within 5 s of a damage jump of the same car sets the damage entry\'s timeLostMs', () => {
      const jump = { at: SLOW_START + 1_000, lap: 5, parts: ['floorPct' as const], deltaPct: 30, lossMsPerLap: unknown('insufficientData') };
      const feed = run(viewOf({ miniSectors, damage: { [car(7)]: damageState([jump]) } as Record<CarId, ReturnType<typeof damageState>> }));
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

  describe('detail: where, damage parts, warning count (I1)', () => {
    const damageOf = (jumps: Parameters<typeof damageState>[0]) =>
      ({ [car(7)]: damageState(jumps) }) as Record<CarId, ReturnType<typeof damageState>>;
    const jump = (at: number, part: 'frontLeftWingPct' | 'floorPct' | 'rearWingPct', deltaPct: number) =>
      ({ at, lap: 5, parts: [part], deltaPct, lossMsPerLap: unknown('insufficientData') });

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
      const damage = only(run(viewOf({ miniSectors: race(), damage: damageOf([jump(T, 'frontLeftWingPct', 12)]) })), 'damage');
      expect(damage.where.sector).toEqual(known(2, T));
      expect(only(run(viewOf({ miniSectors: race(), events: [penalty(7, WARNING)] })), 'warning').where.sector).toEqual(known(2, T));
    });

    it('no invented sector: notApplicable without a car, notReceived before a crossing or without the sector distances', () => {
      const sc = flagPhase({ kind: 'SC', start: T, end: T + 60_000, startLeaderLap: 5, endLeaderLap: 6 });
      expect(only(run(viewOf({ miniSectors: race(), flagPhases: [sc] })), 'neutralised').where.sector).toEqual(unknown('notApplicable'));
      // our car (6) crosses its first boundary at 4 200 ms; the collision is at 1 000 ms
      const early = only(run(viewOf({ miniSectors: until(race(), 3_000), events: [collision(6, 5, 1_000)] })), 'collision');
      expect(early.where.sector).toEqual(unknown('notReceived'));
      const noSectors = viewOf({ miniSectors: race(), events: [collision(6, 5)], session: { sector2StartM: 0, sector3StartM: 0 } });
      expect(only(run(noSectors), 'collision').where.sector).toEqual(unknown('notReceived'));
    });

    it('a damage entry carries its parts and their rise, the biggest first; jumps of the car within the jump window are one entry', () => {
      const jumps = [jump(T, 'frontLeftWingPct', 12), jump(T + 500, 'floorPct', 20), jump(T + 3_000, 'rearWingPct', 8)];
      const feed = run(viewOf({ miniSectors: race(), damage: damageOf(jumps) })).filter((e) => e.kind === 'damage');
      expect(feed.map((e) => e.id)).toEqual([`damage:7:${T + 3_000}`, `damage:7:${T}`]);
      expect(feed[1]!.damage).toEqual([
        { part: 'floorPct', deltaPct: 20 },
        { part: 'frontLeftWingPct', deltaPct: 12 },
      ]);
      expect(feed[0]!.damage).toEqual([{ part: 'rearWingPct', deltaPct: 8 }]);
    });

    it('a warning entry carries its count of the limit: the car\'s nth warning, a penalty every warningsBeforePenalty', () => {
      const events = [
        penalty(7, WARNING, 370_000),
        penalty(7, WARNING, 380_000),
        penalty(7, TIME_PENALTY, 385_000),
        penalty(7, WARNING, 390_000),
        penalty(5, WARNING, 395_000),
        penalty(7, WARNING, 400_000),
      ];
      const counts = (feed: IncidentEntry[], id: number) =>
        feed.filter((e) => e.kind === 'warning' && e.carIds[0] === car(id)).map((e) => e.warning);
      const feed = run(viewOf({ miniSectors: race(), events }));
      expect(counts(feed, 7)).toEqual([1, 3, 2, 1].map((count) => ({ count, limit: 3 })));
      expect(counts(feed, 5)).toEqual([{ count: 1, limit: 3 }]);
      const two = run(viewOf({ miniSectors: race(), events, alarmsConfig: { warningsBeforePenalty: 2 } }));
      expect(counts(two, 7)).toEqual([2, 1, 2, 1].map((count) => ({ count, limit: 2 })));
    });

    it('only damage entries carry damage and only warning entries carry warning', () => {
      const feed = run(viewOf({ miniSectors: race(), events: [collision(6, 5), penalty(7, TIME_PENALTY, T + 100)] }));
      for (const entry of feed) {
        expect('damage' in entry, entry.kind).toBe(false);
        expect('warning' in entry, entry.kind).toBe(false);
      }
    });
  });

  describe('incremental', () => {
    const miniSectors = race({ delays: [slow7(2_500), { carId: PLAYER, lap: 5, segment: 24, ms: 1_800 }] });
    const events = [collision(6, 5), penalty(7, WARNING, 420_000), collision(0, 1, 430_000)];
    const at = (t: number) => viewOf({ miniSectors: until(miniSectors, t), events: until(events, t) });

    it('update in steps equals init over the whole history', () => {
      const steps = [300_000, 383_000, 386_000, 407_900, 410_000, 412_000, 413_000, 425_000, 500_000, 800_000].map(at);
      expect(runSteps(steps)).toEqual(run(steps[steps.length - 1]!));
    });

    it('flashback equals fresh run', () => {
      const full = at(800_000);
      const truncatedView = at(400_000);
      const acc = incidentsCalculator.update(incidentsCalculator.init(at(500_000)), deltaOf(at(500_000), full), full);
      const truncated = incidentsCalculator.update(acc, deltaOf(full, truncatedView, true), truncatedView);
      expect(incidentsCalculator.output(truncated)).toEqual(run(truncatedView));
    });

    it('no duplicate entry after a flashback over the incident', () => {
      const first = viewOf({ miniSectors, events: [collision(6, 5)] });
      const cut = viewOf({ miniSectors: until(miniSectors, 400_000), events: [] });
      // After the flashback the player drives the same stretch again and collides 1.6 s later.
      const again = viewOf({ miniSectors, events: [collision(6, 5, T + 1_600)] });

      let acc = incidentsCalculator.init(first);
      acc = incidentsCalculator.update(acc, deltaOf(first, cut, true), cut);
      acc = incidentsCalculator.update(acc, deltaOf(cut, again), again);
      const feed = incidentsCalculator.output(acc);

      const collisions = feed.filter((e) => e.kind === 'collision');
      expect(collisions.map((e) => e.at)).toEqual([T + 1_600]);
      expect(feed).toEqual(run(again));
    });
  });
});
