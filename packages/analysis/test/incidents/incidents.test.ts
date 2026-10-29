import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type CarId, type IncidentEntry, type Known, type RaceEvent } from '@pitwall/domain';
import { event, flagPhase, lap } from '../../../../test-support/builders/index.ts';
import { incidentsCalculator } from '../../src/incidents/calculator.ts';
import { INCIDENTS, INCIDENTS_CONFIG } from '../../src/incidents/index.ts';
import { DAMAGE } from '../../src/damage/index.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';
import {
  boundaryAt,
  damageState,
  deltaOf,
  PACE_MS,
  pitStop,
  PLAYER,
  race,
  run,
  runSteps,
  startOf,
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
      latest: {},
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
  });

  it('any other penalty type is a minor penalty entry', () => {
    const entry = only(run(viewOf({ miniSectors: race(), events: [penalty(7, TIME_PENALTY)] })), 'penalty');
    expect(entry).toMatchObject({ id: `penalty:7:${T}`, severity: 'minor', carIds: [car(7)] });
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

  describe('forUs', () => {
    // The player collides with car 5 (P6, 0.7 s ahead) at T and loses 1.8 s in that mini-sector (below the time-loss
    // threshold). Five seconds later cars 7 and 8 are through: P7 → P9, 0.7 s → 2.5 s behind car 5.
    const miniSectors = race({ delays: [{ carId: PLAYER, lap: 5, segment: 24, ms: 1_800 }] });

    it('forUs: player P7 before, P9 five seconds later, gap to the car before and after', () => {
      const entry = only(run(viewOf({ miniSectors, events: [collision(6, 5)] })), 'collision');
      expect(entry.forUs).toHaveLength(1);
      const us = entry.forUs[0]!;
      expect(us.ourCarId).toBe(PLAYER);
      expect(us.positionBefore).toBe(7);
      expect(valueOf(us.positionAfter)).toBe(9);
      expect(valueOf(us.gapBeforeMs)).toBe(700);
      expect(valueOf(us.gapAfterMs)).toBe(2_500);
    });

    it('before five seconds have passed in the history, the after values are notReceived', () => {
      const early = until(miniSectors, T + AFTER_MS - 1_900);
      const us = only(run(viewOf({ miniSectors: early, events: [collision(6, 5)] })), 'collision').forUs[0]!;
      expect(us.positionBefore).toBe(7);
      expect(valueOf(us.gapBeforeMs)).toBe(700);
      expect(us.positionAfter).toEqual(unknown('notReceived'));
      expect(us.gapAfterMs).toEqual(unknown('notReceived'));
    });

    it('for a neighbour\'s incident, the gap is ours to that car (positive = we are behind it)', () => {
      const us = only(run(viewOf({ miniSectors: race(), events: [penalty(5, WARNING)] })), 'warning').forUs[0]!;
      expect(us.positionBefore).toBe(7);
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
