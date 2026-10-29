// `damage` (spec 5.5, ruling R1): per-part damage, corners, faults and the jumps from `damageChange` events.
import { carId, known, unknown, type CarId, type DamageParts, type LapRecord, type RaceEvent } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { carState, engineView, event, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { damageCalculator } from '../../src/damage/calculator.ts';
import { DAMAGE } from '../../src/damage/index.ts';

const car0 = carId(0);
const car1 = carId(1);
const dmg = (at: number, part: keyof DamageParts, fromPct: number, toPct: number, id: CarId = car0): RaceEvent =>
  event({ kind: 'damageChange', carId: id, at, params: { part, fromPct, toPct } });

/** Car 0 laps: lap n takes `timeOf(n)` ms and completes at the running total. */
const lapsOf = (count: number, timeOf: (n: number) => number, id: CarId = car0): LapRecord[] => {
  let total = 0;
  return Array.from({ length: count }, (_, i) => {
    const lapTimeMs = timeOf(i + 1);
    total += lapTimeMs;
    return lap({ carId: id, lapNumber: i + 1, lapTimeMs, completedAt: total });
  });
};

const run = (events: RaceEvent[], laps: LapRecord[] = [], extra: Parameters<typeof engineView>[0] = {}) => {
  const view = engineView({
    cars: [carState({ id: car0 })],
    history: { events, laps },
    outputs: new Map([['pace', { byCar: {} }]]),
    ...extra,
  });
  return damageCalculator.output(damageCalculator.init(view))[car0]!;
};

describe('damage calculator', () => {
  it('has the id damage and reads condition, tyres, events, laps (not pace)', () => {
    expect(damageCalculator.id).toBe(DAMAGE);
    expect(damageCalculator.kind).toBe('incremental');
    expect(damageCalculator.reads).toEqual(expect.arrayContaining(['condition', 'tyres', 'events', 'laps']));
    expect(damageCalculator.reads).not.toContainEqual({ calculator: 'pace' });
  });

  it('a damageChange of the front-left wing 0 → 12 % is one jump with deltaPct 12', () => {
    const state = run([dmg(100_000, 'frontLeftWingPct', 0, 12)], lapsOf(3, () => 90_000));
    expect(state.jumps).toHaveLength(1);
    expect(state.jumps[0]).toMatchObject({ at: 100_000, lap: 2, parts: ['frontLeftWingPct'], deltaPct: 12 });
  });

  it('a 3 % rise is not a jump; two rises of 3 % within 2000 ms are one jump of 6 %', () => {
    expect(run([dmg(10_000, 'floorPct', 0, 3)]).jumps).toEqual([]);
    // the second rise 2001 ms after the first is outside the window, so neither reaches 5 %
    expect(run([dmg(10_000, 'floorPct', 0, 3), dmg(12_001, 'floorPct', 3, 6)]).jumps).toEqual([]);
    const jumps = run([dmg(10_000, 'floorPct', 0, 3), dmg(11_500, 'floorPct', 3, 6)]).jumps;
    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toMatchObject({ parts: ['floorPct'], deltaPct: 6 });
    // `at` is the event that brought the sum to jumpPct
    expect(jumps[0]!.at).toBe(11_500);
  });

  it('jumpPct and jumpWindowMs come from the config section damage', () => {
    const events = [dmg(10_000, 'floorPct', 0, 3)];
    expect(run(events, [], { config: { damage: { jumpPct: 3 } } }).jumps).toHaveLength(1);
    const two = [dmg(10_000, 'floorPct', 0, 3), dmg(14_000, 'floorPct', 3, 6)];
    expect(run(two).jumps).toEqual([]);
    expect(run(two, [], { config: { damage: { jumpWindowMs: 5000 } } }).jumps).toHaveLength(1);
  });

  it('rises of two parts within the window are two jumps (jumps are per part), in order of at', () => {
    const jumps = run([dmg(10_000, 'rearWingPct', 0, 8), dmg(10_500, 'floorPct', 0, 6)]).jumps;
    expect(jumps.map((j) => [j.parts, j.deltaPct, j.at])).toEqual([
      [['rearWingPct'], 8, 10_000],
      [['floorPct'], 6, 10_500],
    ]);
  });

  it('events of another car do not count for this car', () => {
    const view = engineView({
      cars: [carState({ id: car0 }), carState({ id: car1 })],
      history: { events: [dmg(10_000, 'floorPct', 0, 9, car1)], laps: [] },
    });
    const out = damageCalculator.output(damageCalculator.init(view));
    expect(out[car0]!.jumps).toEqual([]);
    expect(out[car1]!.jumps).toHaveLength(1);
  });

  it('two jumps in one lap are two entries, both on that lap', () => {
    const state = run([dmg(100_000, 'rearWingPct', 0, 10), dmg(130_000, 'diffuserPct', 0, 7)], lapsOf(3, () => 90_000));
    expect(state.jumps).toHaveLength(2);
    expect(state.jumps.map((j) => [j.lap, j.parts, j.deltaPct])).toEqual([
      [2, ['rearWingPct'], 10],
      [2, ['diffuserPct'], 7],
    ]);
  });

  it('lap is the first lap of the car that completes at or after the jump; a jump on the current lap takes the car lap', () => {
    const view = engineView({
      cars: [carState({ id: car0, timing: { lap: 4 } })],
      history: { events: [dmg(300_000, 'floorPct', 0, 9)], laps: lapsOf(3, () => 90_000) },
    });
    expect(damageCalculator.output(damageCalculator.init(view))[car0]!.jumps[0]!.lap).toBe(4);
  });

  describe('lossMsPerLap', () => {
    // laps 1..4 at 90 s (lap 1 of a race is no pace lap, so 2..4 are the "before"), jump during lap 5, then 91 s laps
    const timeOf = (n: number) => (n <= 5 ? 90_000 : 91_000);
    const jump = [dmg(405_000, 'frontRightWingPct', 0, 20)];

    it('is insufficientData until two pace laps after the jump, then pace after minus before', () => {
      const none = run(jump, lapsOf(5, timeOf)).jumps[0]!;
      expect(none.lap).toBe(5);
      expect(none.lossMsPerLap).toEqual(unknown('insufficientData'));
      expect(run(jump, lapsOf(6, timeOf)).jumps[0]!.lossMsPerLap).toEqual(unknown('insufficientData'));
      const seven = lapsOf(7, timeOf);
      const loss = run(jump, seven).jumps[0]!.lossMsPerLap;
      // before: laps 2..4 (90 s); the jump's own lap 5 is in neither; after: laps 6 and 7 (91 s)
      expect(loss).toEqual(known(1000, seven[6]!.completedAt));
    });

    it('uses only pace laps: an in-lap after the jump is skipped', () => {
      const laps = lapsOf(8, timeOf).map((l) => (l.lapNumber === 6 ? { ...l, inLap: true, lapTimeMs: 150_000 } : l));
      const loss = run(jump, laps).jumps[0]!.lossMsPerLap;
      // only lap 7 and 8 remain after: mean 91 s, before 90 s
      expect(loss).toMatchObject({ known: true, value: 1000, at: laps[7]!.completedAt });
    });

    it('uses the last 3 pace laps before and the first 3 after (the pace window): laps outside it do not change the loss', () => {
      // laps complete at 90, 290, 380, 470, 560, 650 s ...: the jump at 600 s is in lap 6; lap 2 is slow and lies before the last 3 pace laps (3..5); lap 11 is slow and lies after the first 3 (7..9)
      const bounded = (n: number) => (n === 2 || n === 11 ? 200_000 : n <= 6 ? 90_000 : 91_000);
      const laps = lapsOf(11, bounded);
      const loss = run([dmg(600_000, 'frontRightWingPct', 0, 20)], laps).jumps[0]!;
      expect(loss.lap).toBe(6);
      expect(loss.lossMsPerLap).toEqual(known(1000, laps[8]!.completedAt));
    });

    it('needs two pace laps before the jump too', () => {
      const early = [dmg(100_000, 'frontRightWingPct', 0, 20)]; // lap 2: only lap 1 (no pace lap in a race) before
      expect(run(early, lapsOf(6, timeOf)).jumps[0]!.lossMsPerLap).toEqual(unknown('insufficientData'));
    });

    it('is measured per car', () => {
      const view = engineView({
        cars: [carState({ id: car0 }), carState({ id: car1 })],
        history: { events: jump, laps: [...lapsOf(7, timeOf), ...lapsOf(7, () => 80_000, car1)] },
      });
      const out = damageCalculator.output(damageCalculator.init(view));
      expect(out[car0]!.jumps[0]!.lossMsPerLap).toMatchObject({ known: true, value: 1000 });
      expect(out[car1]!.jumps).toEqual([]);
    });

    it('update recomputes it when laps arrive without a new event', () => {
      const early = engineView({ cars: [carState({ id: car0 })], history: { events: jump, laps: lapsOf(6, timeOf) } });
      const late = engineView({ cars: [carState({ id: car0 })], history: { events: jump, laps: lapsOf(7, timeOf) } });
      const acc = damageCalculator.update(damageCalculator.init(early), late.delta, late);
      expect(damageCalculator.output(acc)[car0]!.jumps[0]!.lossMsPerLap).toMatchObject({ known: true, value: 1000 });
    });
  });

  describe('state now', () => {
    it('parts: the eight damage percentages from bodywork and power unit, known at the session time', () => {
      const car = carState({
        id: car0,
        condition: {
          bodywork: known({ frontLeftWingPct: 1, frontRightWingPct: 2, rearWingPct: 3, floorPct: 4, diffuserPct: 5, sidepodPct: 6 }, 0),
          powerUnit: known({ engineDamagePct: 8, gearboxDamagePct: 7, mguhWearPct: 0, esWearPct: 0, ceWearPct: 0, iceWearPct: 0, mgukWearPct: 0, tcWearPct: 0 }, 0),
        },
      });
      const out = damageCalculator.output(damageCalculator.init(engineView({ cars: [car], sessionTime: 5000 })))[car0]!;
      expect(out.parts).toEqual(
        known(
          { frontLeftWingPct: 1, frontRightWingPct: 2, rearWingPct: 3, floorPct: 4, diffuserPct: 5, sidepodPct: 6, gearboxPct: 7, enginePct: 8 },
          5000,
        ),
      );
    });

    it('corners: tyre damage and brake damage per corner; faults pass through', () => {
      const car = carState({
        id: car0,
        tyres: { corners: { fl: { damagePct: known(11, 0) }, rr: { damagePct: known(22, 0) } } },
        condition: { brakes: { fr: { damagePct: known(33, 0) }, rl: { damagePct: known(44, 0) } }, drsFault: known(true, 0), ersFault: true },
      });
      const out = damageCalculator.output(damageCalculator.init(engineView({ cars: [car] })))[car0]!;
      expect(out.corners.fl.tyrePct).toEqual(known(11, 0));
      expect(out.corners.rr.tyrePct).toEqual(known(22, 0));
      expect(out.corners.fr.tyrePct).toEqual(known(0, 0));
      expect(out.corners.fr.brakePct).toEqual(known(33, 0));
      expect(out.corners.rl.brakePct).toEqual(known(44, 0));
      expect(out.drsFault).toEqual(known(true, 0));
      expect(out.ersFault).toBe(true);
    });

    it('a rival hidden by realism mode has unknown parts, brakes and drsFault, never 0', () => {
      const hidden = realismHidden(carState({ id: car0 }));
      const out = damageCalculator.output(damageCalculator.init(engineView({ cars: [hidden] })))[car0]!;
      expect(out.parts).toMatchObject({ known: false, reason: 'realism' });
      expect(out.drsFault).toMatchObject({ known: false, reason: 'realism' });
      expect(out.corners.fl.brakePct).toMatchObject({ known: false, reason: 'realism' });
    });

    it('only active cars get an entry', () => {
      const out = damageCalculator.output(damageCalculator.init(engineView({ cars: [carState({ id: car1 })] })));
      expect(Object.keys(out)).toEqual(['1']);
    });
  });

  it('flashback equals fresh run', () => {
    const timeOf = (n: number) => (n <= 5 ? 90_000 : 91_000);
    const events = [dmg(100_000, 'rearWingPct', 0, 10), dmg(405_000, 'frontRightWingPct', 0, 20), dmg(480_000, 'floorPct', 0, 3), dmg(481_000, 'floorPct', 3, 6)];
    const laps = lapsOf(8, timeOf);
    const full = engineView({ cars: [carState({ id: car0 })], history: { events, laps } });
    const acc = damageCalculator.update(damageCalculator.init(engineView({ cars: [carState({ id: car0 })] })), full.delta, full);
    expect(damageCalculator.output(acc)).toEqual(damageCalculator.output(damageCalculator.init(full)));

    // flashback to just after lap 3: later events and laps are gone
    const cut = engineView({
      cars: [carState({ id: car0 })],
      history: { events: events.slice(0, 1), laps: laps.slice(0, 3) },
    });
    const truncated = { ...cut.delta, truncated: true };
    const after = damageCalculator.update(acc, truncated, { ...cut, delta: truncated });
    expect(damageCalculator.output(after)).toEqual(damageCalculator.output(damageCalculator.init(cut)));
    expect(damageCalculator.output(after)[car0]!.jumps).toHaveLength(1);
  });
});
