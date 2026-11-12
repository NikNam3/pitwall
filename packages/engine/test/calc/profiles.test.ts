// `view.drivers` (C39, C62c; SP4.3a plan Task 3): per car slot its linked person's profile from the run's profile
// snapshot (`driversOf`), `notApplicable` for an unlinked slot and for every slot without a snapshot; the scheduler builds
// it once per pass from `SchedulerInput.drivers` and the live state's car slots.
import { describe, expect, it } from 'vitest';
import { carId, unknown, type DriverProfile, type ProfileSnapshot } from '@pitwall/domain';
import { driversOf, type EngineView } from '../../src/index.ts';
import { run, script, gridStart } from '../situations/script.ts';
import { inputOf, quick, sched } from '../support/scheduler.ts';

const profile = (person: string, sigmaMs: number): DriverProfile => ({
  person,
  displayName: person.toUpperCase(),
  entries: { 'driverNoise.sigmaMs': { value: { known: true, value: sigmaMs, at: 0 }, laps: 40, sessions: 2, newestSession: '2026-11-05' } },
});

/** 22 slots: slot 3 linked to `dr`, slot 7 to `asym`, every other slot unlinked. */
const SNAPSHOT: ProfileSnapshot = {
  fingerprint: 'fp-1',
  bySlot: Array.from({ length: 22 }, (_, i) => (i === 3 ? 'dr' : i === 7 ? 'asym' : null)),
  profiles: { dr: profile('dr', 380), asym: profile('asym', 910) },
};

describe('driversOf (C62c)', () => {
  it('driversOf: null gives notApplicable per slot; a linked slot gets its profile', () => {
    expect(driversOf(null, 22)).toEqual(Array.from({ length: 22 }, () => unknown('notApplicable')));
    const drivers = driversOf(SNAPSHOT, 22);
    expect(drivers).toHaveLength(22);
    expect(drivers[3]).toMatchObject({ known: true, value: SNAPSHOT.profiles['dr'] });
    expect(drivers[7]).toMatchObject({ known: true, value: SNAPSHOT.profiles['asym'] });
    drivers.forEach((d, i) => {
      if (i !== 3 && i !== 7) expect(d, `slot ${i}`).toEqual(unknown('notApplicable'));
    });
  });

  it('a slot past the snapshot\'s list, or linked to a person without a profile, is notApplicable', () => {
    const short: ProfileSnapshot = { fingerprint: 'fp-2', bySlot: ['dr', 'ghost'], profiles: { dr: profile('dr', 380) } };
    const drivers = driversOf(short, 4);
    expect(drivers).toHaveLength(4);
    expect(drivers[0]).toMatchObject({ known: true, value: short.profiles['dr'] });
    expect(drivers.slice(1)).toEqual([unknown('notApplicable'), unknown('notApplicable'), unknown('notApplicable')]);
  });
});

describe('the scheduler builds view.drivers (C39, C62c)', () => {
  const race = () => run(script(gridStart(5))).results;

  it('a unit that declares drivers sees driversOf(input.drivers, live.cars.length), with and without a snapshot', () => {
    const last = race().at(-1)!;
    const seen: EngineView['drivers'][] = [];
    const s = sched([quick('reader', { reads: ['timing', 'drivers'], compute: (v) => (seen.push(v.drivers), v.drivers.length) })]);
    const without = inputOf(last);
    const cars = without.live.cars.length;
    expect(cars).toBeGreaterThan(0);
    expect(s.run(without).errors).toEqual([]);
    expect(seen.at(-1)).toEqual(driversOf(null, cars));

    const linked = sched([quick('reader', { reads: ['timing', 'drivers'], compute: (v) => (seen.push(v.drivers), v.drivers.length) })]);
    const withSnapshot = { ...inputOf(last), drivers: { ...SNAPSHOT, bySlot: Array.from({ length: cars }, (_, i) => (i === 1 ? 'dr' : null)) } };
    expect(linked.run(withSnapshot).errors).toEqual([]);
    expect(seen.at(-1)).toHaveLength(cars);
    expect(seen.at(-1)![1]).toMatchObject({ known: true, value: SNAPSHOT.profiles['dr'] });
    expect(seen.at(-1)![carId(0)]).toEqual(unknown('notApplicable'));
  });

  it('declaring drivers runs on: a unit reading drivers and timing runs again on a timing change, without an error', () => {
    const results = race();
    // `drivers` first: whether it is affected is asked of it before `timing`
    const s = sched([quick('reader', { reads: ['drivers', 'timing'], compute: (v) => v.drivers.length })]);
    const runs = results.slice(-3).map((r) => s.run(inputOf(r)));
    expect(runs.flatMap((r) => r.errors)).toEqual([]);
    expect(runs.every((r) => r.ran.includes('reader'))).toBe(true);
  });
});
