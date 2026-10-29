// `lap-times` (spec 6.2): the board part of the calculator output, plus update and flashback over the whole output.
import { carId, known, type LapRecord, type MiniSectorCrossing } from '@pitwall/domain';
import { historyLengths, type EngineView } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { crossings, field } from '../../../../test-support/builders/index.ts';
import { lapTimesCalculator } from '../../src/lap-times/calculator.ts';
import { LAP_TIMES } from '../../src/lap-times/index.ts';
import { activeCars, rowOf, run, scene, sectorLap } from './scene.ts';

describe('lap-times calculator', () => {
  it('is the incremental calculator `lap-times` over the laps and the mini-sectors', () => {
    expect(lapTimesCalculator.id).toBe(LAP_TIMES);
    expect(lapTimesCalculator.kind).toBe('incremental');
    expect(lapTimesCalculator.reads).toEqual(expect.arrayContaining(['laps', 'miniSectors', 'timing', 'session']));
  });

  it('has a row per active car', () => {
    const { laps } = field({ cars: 2, laps: 2, paceMs: [90_000, 91_000] });
    const out = run(scene({ laps, cars: activeCars(3) }));
    expect(out.rows.map((r) => r.carId).sort()).toEqual([0, 1, 2]);
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
  const allCrossings: MiniSectorCrossing[] = [...base.miniSectors, ...crossings(carId(0), 3, 89_000, 180_000), ...crossings(carId(1), 3, 91_000, 182_000)];

  /** The session as it stood at time `t`: the laps and crossings until then, each car on the lap after its last one. */
  const at = (t: number): EngineView => {
    const laps = allLaps.filter((l) => l.completedAt <= t);
    const done = (id: number) => laps.filter((l) => l.carId === id).length;
    const cars = activeCars(2, { 0: { lap: done(0) + 1, driverStatus: 'flyingLap' }, 1: { lap: done(1) + 1, driverStatus: 'flyingLap' } });
    const miniSectors = allCrossings.filter((m) => m.at <= t);
    return scene({ laps, miniSectors, cars, sessionTime: t });
  };

  it('update over a delta equals init over the whole history', () => {
    let view = at(0);
    let acc = lapTimesCalculator.init(view);
    for (let t = 20_000; t <= 280_000; t += 20_000) {
      const next = at(t);
      acc = lapTimesCalculator.update(acc, { before: historyLengths(view.state.history), after: historyLengths(next.state.history), truncated: false }, next);
      view = next;
      expect(lapTimesCalculator.output(acc), `t ${t}`).toEqual(run(next));
    }
  });

  it('flashback equals fresh run: a best lap removed by a flashback is not the best any more', () => {
    const full = at(280_000);
    const before = run(full);
    expect(rowOf(before, 0)!.bestLapMs).toEqual(known(89_000, 269_000));
    expect(before.sessionBest.lap).toEqual(known({ ms: 89_000, carId: carId(0) }, 269_000));

    // a flashback to 200 s takes car 0's lap 3 away
    const back = at(200_000);
    const acc = lapTimesCalculator.update(
      lapTimesCalculator.init(full),
      { before: historyLengths(full.state.history), after: historyLengths(back.state.history), truncated: true },
      back,
    );
    const after = lapTimesCalculator.output(acc);
    expect(after).toEqual(run(back));
    expect(rowOf(after, 0)!.bestLapMs).toEqual(known(90_000, 90_000));
    expect(after.sessionBest.lap).toEqual(known({ ms: 90_000, carId: carId(0) }, 90_000));
  });
});
