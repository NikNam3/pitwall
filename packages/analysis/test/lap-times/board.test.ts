// `lap-times` (spec 6.2): the board part of the calculator output, plus update and flashback over the whole output.
import { carId, known, unknown, type LapRecord, type MiniSectorCrossing } from '@pitwall/domain';
import { projectionLengths, type EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { crossings, field } from '../../../../test-support/builders/index.ts';
import { lapTimesCalculator } from '../../src/lap-times/calculator.ts';
import { LAP_TIMES } from '../../src/lap-times/index.ts';
import { activeCars, guarded, lapTimes, rowOf, run, scene, sectorLap } from './scene.ts';

describe('lap-times calculator', () => {
  it('is the incremental calculator `lap-times` over the laps and the mini-sectors', () => {
    expect(lapTimesCalculator.id).toBe(LAP_TIMES);
    expect(lapTimesCalculator.kind).toBe('incremental');
    expect(lapTimesCalculator.reads).toEqual(expect.arrayContaining(['laps', 'miniSectors', 'timing', 'session']));
    // the situations it takes its behaviour from (C41, C44): the table covers each of these machines
    expect(lapTimesCalculator.reads).toEqual(
      expect.arrayContaining(['spans:weekend-phase', 'spans:car-status', 'spans:car-location', 'spans:car-activity-race', 'spans:car-activity-qualifying', 'spans:car-activity-practice']),
    );
    // nothing in the outputs needs the pace calculator
    expect(lapTimesCalculator.reads).not.toContainEqual({ calculator: 'pace' });
  });

  // Task 24: the transitional `car.active` left the live state; car-status alone says who is in the session (C43)
  it('has a row per car in the session (car-status not absent)', () => {
    const { laps } = field({ cars: 2, laps: 2, paceMs: [90_000, 91_000] });
    const cars = activeCars(4); // car 2 competing by its span: has a row; car 3 absent by its span: has none
    const out = run(scene({ laps, cars, kinds: { 3: { status: 'absent' } } }));
    expect(out.rows.map((r) => r.carId).sort()).toEqual([0, 1, 2]);
    expect(Object.keys(out.projections).map(Number).sort()).toEqual([0, 1, 2]);
  });

  it('a car without a car-status span has no row (not in the session)', () => {
    const view = scene({ cars: activeCars(2) });
    const bare = { ...view, situation: { ...view.situation, byMachine: { ...view.situation.byMachine, 'car-status': [] } } };
    expect(run(bare).rows).toEqual([]);
  });
});

describe('lap-times board', () => {
  // car 1 sets 29.0 / 29.8 / 30.5; car 0 then 30.0 / 30.0 / 30.0, then 29.5 / 30.1 / 29.9
  const laps = [
    sectorLap(1, 1, [29_000, 29_800, 30_500], 89_300),
    sectorLap(0, 1, [30_000, 30_000, 30_000], 90_000),
    sectorLap(0, 2, [29_500, 30_100, 29_900], 179_500),
  ];
  const out = run(scene({ laps, cars: activeCars(2) }));

  it('sector status: a new session-best sector is sessionBest; a personal best not session best is personalBest', () => {
    const car0 = rowOf(out, 0)!;
    // sector 1: 29.5 beats car 0's 30.0 but not car 1's 29.0; sector 2: 30.1 is slower than 30.0; sector 3: 29.9 beats everyone
    expect(car0.lastSectorStatus).toEqual(['personalBest', 'none', 'sessionBest']);
    // 89.5 s is car 0's best, car 1's 89.3 s the session's
    expect(car0.lastLapStatus).toBe('personalBest');
    expect(car0.lastLapMs).toEqual(known(89_500, 179_500));
    expect(car0.lastSectorsMs).toEqual([known(29_500, 179_500), known(30_100, 179_500), known(29_900, 179_500)]);

    const car1 = rowOf(out, 1)!;
    // car 1's 30.5 is its own best sector 3, beaten by car 0's 29.9
    expect(car1.lastSectorStatus).toEqual(['sessionBest', 'sessionBest', 'personalBest']);
    expect(car1.lastLapStatus).toBe('sessionBest');
  });

  it("best status: each best lap and best sector is sessionBest when it is the session's, else none (never personalBest)", () => {
    const car0 = rowOf(out, 0)!;
    const car1 = rowOf(out, 1)!;
    // car 1 holds the best lap and sectors 1 and 2; car 0 holds sector 3
    expect(car1.bestLapStatus).toBe('sessionBest');
    expect(car1.bestSectorStatus).toEqual(['sessionBest', 'sessionBest', 'none']);
    expect(car0.bestLapStatus).toBe('none');
    expect(car0.bestSectorStatus).toEqual(['none', 'none', 'sessionBest']);
  });

  it('best status is none for a car without a best yet', () => {
    const row = rowOf(run(scene({ laps: [], cars: activeCars(1) })), 0)!;
    expect(row.bestLapStatus).toBe('none');
    expect(row.bestSectorStatus).toEqual(['none', 'none', 'none']);
  });

  it('the session bests carry their holder, known since the lap that set them', () => {
    expect(out.sessionBest.lap).toEqual(known({ ms: 89_300, carId: carId(1) }, 89_300));
    expect(out.sessionBest.sectors).toEqual([
      known({ ms: 29_000, carId: carId(1) }, 89_300),
      known({ ms: 29_800, carId: carId(1) }, 89_300),
      known({ ms: 29_900, carId: carId(0) }, 179_500),
    ]);
  });

  it('theoretical best is the sum of the best valid sectors', () => {
    const own = [
      sectorLap(0, 1, [30_000, 30_500, 29_800], 90_300),
      sectorLap(0, 2, [29_700, 30_800, 30_100], 180_900),
      // an invalid lap with an invalid sector 1: its 29.0 counts for nothing, its valid 30.2 counts as a sector best
      sectorLap(0, 3, [29_000, 30_200, 30_300], 270_400, { valid: { lap: false, sectors: [false, true, true] } }),
    ];
    const row = rowOf(run(scene({ laps: own, cars: activeCars(1) })), 0)!;
    expect(row.bestSectorsMs).toEqual([known(29_700, 180_900), known(30_200, 270_400), known(29_800, 90_300)]);
    // known since the newest of the three sectors
    expect(row.theoreticalBestMs).toEqual(known(29_700 + 30_200 + 29_800, 270_400));
    // the invalid 89.5 s lap is not the best lap
    expect(row.bestLapMs).toEqual(known(90_300, 90_300));
    // the last lap is shown as driven; an invalid sector or lap ranks as none
    expect(row.lastLapMs).toEqual(known(89_500, 270_400));
    expect(row.lastSectorStatus).toEqual(['none', 'sessionBest', 'none']);
    expect(row.lastLapStatus).toBe('none');
  });
});

describe('lap-times update and flashback', () => {
  // car 0 laps at 90 s, then a 89 s lap 3; car 1 at 91 s; both on lap 4 at the end
  const base = field({ cars: 2, laps: 2, paceMs: [90_000, 91_000] });
  const allLaps: LapRecord[] = [
    ...base.laps,
    sectorLap(0, 3, [29_600, 29_700, 29_700], 269_000),
    sectorLap(1, 3, [30_333, 30_333, 30_334], 273_000),
  ];
  // engine convention: `field` already holds each car's lap-3 start line (3, 0); lap 3 adds segments 1..49 and the closing (4, 0)
  const lapThree = (id: number, paceMs: number, startAt: number): MiniSectorCrossing[] => [
    ...crossings(carId(id), 3, paceMs, startAt).slice(1),
    { carId: carId(id), lap: 4, segment: 0, at: startAt + paceMs, frame: 0 },
  ];
  const allCrossings: MiniSectorCrossing[] = [...base.crossings, ...lapThree(0, 89_000, 180_000), ...lapThree(1, 91_000, 182_000)];

  /** The session as it stood at time `t`: the laps and crossings until then, each car on the lap after its last one. */
  const at = (t: number): EngineView => {
    const laps = allLaps.filter((l) => l.completedAt <= t);
    const done = (id: number) => laps.filter((l) => l.carId === id).length;
    const cars = activeCars(2, { 0: { lap: done(0) + 1 }, 1: { lap: done(1) + 1 } });
    const miniSectors = allCrossings.filter((m) => m.at <= t);
    return scene({ laps, miniSectors, cars, sessionTime: t });
  };

  it('update over a delta equals init over the whole history', () => {
    let view = at(0);
    let acc = lapTimes.init(guarded(view));
    for (let t = 20_000; t <= 280_000; t += 20_000) {
      const next = at(t);
      acc = lapTimes.update(acc, { before: projectionLengths(view.history), after: projectionLengths(next.history) }, guarded(next));
      view = next;
      expect(lapTimes.output(acc), `t ${t}`).toEqual(run(next));
    }
  });

  it('flashback equals fresh run: a best lap removed by a flashback is not the best any more', () => {
    const full = at(280_000);
    const before = run(full);
    expect(rowOf(before, 0)!.bestLapMs).toEqual(known(89_000, 269_000));
    expect(before.sessionBest.lap).toEqual(known({ ms: 89_000, carId: carId(0) }, 269_000));

    // a flashback to 200 s takes car 0's lap 3 away
    const back = at(200_000);
    const acc = lapTimes.update(
      lapTimes.init(guarded(full)),
      { before: projectionLengths(full.history), after: projectionLengths(back.history), rewound: { frameId: -1, at: 0 } },
      guarded(back),
    );
    const after = lapTimes.output(acc);
    expect(after).toEqual(run(back));
    expect(rowOf(after, 0)!.bestLapMs).toEqual(known(90_000, 90_000));
    expect(after.sessionBest.lap).toEqual(known({ ms: 90_000, carId: carId(0) }, 90_000));
  });
});

// A car out of the race sets no more times: what it lacks will not come (notApplicable), not "too few laps yet"; the
// display shows "will not come" for it. Car-status decides (C17, C43): `retired` and `disqualified` are out, `competing`
// is not; the game's result status is no longer read.
describe('lap-times board: car-status rows', () => {
  const notApplicable = unknown('notApplicable');
  // car 0 has a lap; car 1 has none
  const laps = [sectorLap(0, 1, [30_000, 30_000, 30_000], 90_000)];
  // Task 24 (C13): the result status left the live state; car-status's span is the one input
  const withStatus = (status: string) =>
    run(scene({ laps, cars: activeCars(2), kinds: { 1: { status } } }));

  it.each(['retired', 'disqualified'])('row car-status %s: the car is out; its times and bests it lacks will not come (notApplicable)', (status) => {
    const out = withStatus(status);
    const row = rowOf(out, 1)!;
    expect(row.outOfRace).toBe(true);
    expect(rowOf(out, 0)!.outOfRace).toBe(false);
    expect(row.lastLapMs).toEqual(notApplicable);
    expect(row.lastSectorsMs).toEqual([notApplicable, notApplicable, notApplicable]);
    expect(row.bestLapMs).toEqual(notApplicable);
    expect(row.bestSectorsMs).toEqual([notApplicable, notApplicable, notApplicable]);
    expect(row.theoreticalBestMs).toEqual(notApplicable);
    expect(out.projections[carId(1)]).toMatchObject({ onLap: true, projectedLapMs: notApplicable, deltaToBestMs: notApplicable, projectedPosition: notApplicable, finishMarginMs: notApplicable });
  });

  it('row car-status retired equals disqualified: one rule for both', () => {
    expect(withStatus('retired')).toEqual(withStatus('disqualified'));
  });

  it('row car-status competing: the car waits for its times (insufficientData)', () => {
    const row = rowOf(withStatus('competing'), 1)!;
    expect(row.outOfRace).toBe(false);
    expect(row.lastLapMs).toEqual(unknown('insufficientData'));
    expect(row.bestLapMs).toEqual(unknown('insufficientData'));
  });

  it('row car-status absent: no row and no projection (not in the session)', () => {
    const out = withStatus('absent');
    expect(rowOf(out, 1)).toBeUndefined();
    expect(out.projections[carId(1)]).toBeUndefined();
  });

  it('a retired car keeps the times it set; only the bests it lacks will not come', () => {
    // its one lap is invalid: a last lap, but no best lap and no best sectors
    const own = [sectorLap(1, 1, [30_500, 30_500, 30_500], 91_500, { valid: { lap: false, sectors: [false, false, false] } })];
    const row = rowOf(run(scene({ laps: [...laps, ...own], cars: activeCars(2), kinds: { 1: { status: 'retired' } } })), 1)!;
    expect(row.lastLapMs).toEqual(known(91_500, 91_500));
    expect(row.bestLapMs).toEqual(notApplicable);
    expect(row.bestSectorsMs).toEqual([notApplicable, notApplicable, notApplicable]);
    expect(row.theoreticalBestMs).toEqual(notApplicable);
  });

  it('a car out of the race with valid laps keeps its times and is still out', () => {
    const own = [sectorLap(1, 1, [30_500, 30_500, 30_500], 91_500)];
    const row = rowOf(run(scene({ laps: [...laps, ...own], cars: activeCars(2), kinds: { 1: { status: 'retired' } } })), 1)!;
    expect(row.lastLapMs).toEqual(known(91_500, 91_500));
    expect(row.outOfRace).toBe(true);
  });

  it('a car that retires between two updates: the update equals a fresh run', () => {
    const running = scene({ laps, cars: activeCars(2) });
    const retired = scene({ laps, cars: activeCars(2), kinds: { 1: { status: 'retired' } } });
    const lengths = projectionLengths(running.history);
    const acc = lapTimes.update(lapTimes.init(guarded(running)), { before: lengths, after: lengths }, guarded(retired));
    expect(lapTimes.output(acc)).toEqual(run(retired));
    expect(rowOf(lapTimes.output(acc), 1)!.bestLapMs).toEqual(notApplicable);
    expect(rowOf(lapTimes.output(acc), 1)!.outOfRace).toBe(true);
  });
});
