import { describe, expect, it } from 'vitest';
import { carId, carKeyOf, carKeyString, OUT_OF_RACE_STATUSES, type FeedId, type ResultStatus } from '@pitwall/domain';
import { initialState, participantsValuesOf, situationOf, step, type EngineState, type StepOutput } from '../../src/index.ts';
import { readSignals } from '../../src/signals/read.ts';
import { carsInSessionOf } from '../../src/situations/car-status/in-session.ts';
import { identityUpdate } from '../../src/step/state-update/identity.ts';
import { ScenarioBuilder } from '../builders/index.ts';

const run = (b: ScenarioBuilder) => {
  const frames = b.build();
  const st = initialState({ feedId: 'test' as FeedId, sessionUid: frames[0]!.sessionUid, session: frames[0]!.session! });
  return { st, frames, results: frames.map((f) => step(st, f)) };
};

/** Whether each of the first `n` slots holds a car of the session: car-status's decision (C43), no longer `car.active` (Task 24). */
const inSession = (st: EngineState, n: number): boolean[] => {
  const cars = carsInSessionOf(situationOf(st).byMachine['car-status']);
  return Array.from({ length: n }, (_, i) => cars.includes(carId(i)));
};

describe('car identity', () => {
  // Task 27 (user, 2026-11-04): pitwall stores no player identity; a car is matched across a weekend by its team and
  // race number (C62), so the identity has no driver key
  it('AI: identity with team and race number, public, no driver key', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).frames(1, () => {}));
    expect(st.cars[2]!.identity).toMatchObject({ name: 'DRIVER 2', teamId: 1, raceNumber: 3, networkId: 255, visibility: 'public' });
    expect(st.cars[2]!.identity).not.toHaveProperty('driverKey');
  });
  it('player = header.playerCarIndex: own, holds ownCar', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4, player: 3 }).frames(1, () => {}));
    expect(st.playerCar).toBe(3);
    expect(st.cars[3]!.identity).toMatchObject({ name: 'DRIVER 3', networkId: 0, visibility: 'own' });
    expect([st.cars[3]!.ownCar !== undefined, st.cars[0]!.ownCar]).toEqual([true, undefined]);
  });
  it('human non-player with yourTelemetry 0 is restricted; 1 is public; AI is public regardless', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).participants({ participants: { 1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 },
      2: { aiControlled: 0, networkId: 6, yourTelemetry: 1 }, 3: { yourTelemetry: 0 } } }).frames(1, () => {}));
    expect([1, 2, 3].map((i) => st.cars[i]!.identity.visibility)).toEqual(['restricted', 'public', 'public']);
    expect(carKeyOf(st.cars[1]!.identity)).toEqual({ teamId: 0, raceNumber: 2 });
  });
  it('participantsValuesOf names the player slot and the car key (team, race number) of every slot the packet carries', () => {
    const frame = new ScenarioBuilder({ cars: 4, player: 3 }).frames(1, () => {}).build()[0]!;
    const p = frame.participants!;
    const values = participantsValuesOf(frame, p);
    expect(values.playerCar).toBe(carId(3));
    expect(values.cars.map((c) => c.carId)).toEqual(p.participants.map((_, i) => carId(i)));
    expect(values.cars.slice(0, 4)).toEqual([
      { carId: carId(0), carKey: { teamId: 0, raceNumber: 1 } },
      { carId: carId(1), carKey: { teamId: 0, raceNumber: 2 } },
      { carId: carId(2), carKey: { teamId: 1, raceNumber: 3 } },
      { carId: carId(3), carKey: { teamId: 1, raceNumber: 4 } },
    ]);
  });
  it('a car keeps its key whoever drives it: the name and the network id are no part of it', () => {
    // weekend 3895515742 (Q-M6-1): one car, a different driver per session
    const keyOfSlot1 = (name: string, networkId: number) => {
      const frame = new ScenarioBuilder({ cars: 4 }).participants({ participants: { 1: { name, networkId, teamId: 4, raceNumber: 14 } } })
        .frames(1, () => {}).build()[0]!;
      return participantsValuesOf(frame, frame.participants!).cars[1]!.carKey;
    };
    expect(keyOfSlot1('ALONSO', 255)).toEqual({ teamId: 4, raceNumber: 14 });
    expect(carKeyString(keyOfSlot1('STROLL', 3))).toBe(carKeyString(keyOfSlot1('ALONSO', 255)));
  });
  it('the cars in the session follow numActiveCars', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).participants({ numActiveCars: 3 }).frames(1, () => {}));
    expect(inSession(st, 5)).toEqual([true, true, true, false, false]);
  });
  it('teammate: same teamId as the player, not the player, active', () => {
    expect(run(new ScenarioBuilder({ cars: 6, player: 4 }).frames(1, () => {})).st.teammateCar).toBe(5);
    expect(run(new ScenarioBuilder({ cars: 6, player: 4 }).participants({ numActiveCars: 5 }).frames(1, () => {})).st.teammateCar).toBeUndefined();
  });
  it('tags identity on Participants frames and when the player changes', () => {
    const { st, frames, results } = run(new ScenarioBuilder({ cars: 2 }).frames(2, () => {}));
    expect(results.map((r) => r.changed.has('identity'))).toEqual([true, false]);
    const r = step(st, { ...frames[1]!, playerCarIndex: 1 });
    expect([r.changed.has('identity'), st.playerCar, st.cars[1]!.identity.visibility, st.cars[0]!.identity.visibility]).toEqual([true, 1, 'own', 'public']);
    expect([st.cars[1]!.ownCar !== undefined, st.cars[0]!.ownCar]).toEqual([true, undefined]);
  });

  // The game lowers numActiveCars when a car drops out but keeps every car in its slot (b-report.md, failure 1).
  it.each([[7, 'retired'], [5, 'disqualified'], [4, 'didNotFinish'], [6, 'notClassified']] as const)(
    'a car out of the race (result status %i, %s) keeps its slot: every car of a 4-car field stays in the session when numActiveCars drops to 3',
    (resultStatus, _name) => {
      const { st } = run(new ScenarioBuilder({ cars: 4 }).frames(1, () => {})
        .participants({ numActiveCars: 3 }).frames(1, (d) => { d.lapData.lapData[1]!.resultStatus = resultStatus; }));
      expect(inSession(st, 5)).toEqual([true, true, true, true, false]);
    },
  );

  // One set of out-of-race statuses (supervisor, wave 4): the engine counts a car's slot as out of the race exactly when
  // the domain's OUT_OF_RACE_STATUSES holds its status, so a status added there changes the engine too.
  /** Every result status, by the game's code (LapData `resultStatus` 0..7); a Record, so a new status must be named here. */
  const BY_CODE: Record<ResultStatus, number> = {
    invalid: 0, inactive: 1, active: 2, finished: 3, didNotFinish: 4, disqualified: 5, notClassified: 6, retired: 7,
  };
  it.each(Object.entries(BY_CODE) as Array<[ResultStatus, number]>)(
    'a car with result status %s (code %i) adds a slot when numActiveCars drops exactly when the domain counts it out of the race',
    (status, code) => {
      const { st } = run(new ScenarioBuilder({ cars: 4 }).frames(1, () => {})
        .participants({ numActiveCars: 3 }).frames(1, (d) => { d.lapData.lapData[1]!.resultStatus = code; }));
      expect(st.signals.cars[1]!.resultStatus).toBe(status);
      expect(inSession(st, 4)[3]).toBe(OUT_OF_RACE_STATUSES.has(status));
    },
  );

  // Task 24 ruling 2 (C8, C13): the identity module places the teammate by the signals step 1 wrote this frame
  // (`state.signals`: the result statuses and numActiveCars), never by the live state or its own packet reading.
  describe('the teammate follows the signals of the frame', () => {
    /** A 6-car frame (the player 4, its teammate 5) and the signals step 1 read from it, before the identity module runs. */
    const setup = () => {
      const frame = new ScenarioBuilder({ cars: 6, player: 4 }).frames(1, () => {}).build()[0]!;
      const st = initialState({ feedId: 'test' as FeedId, sessionUid: frame.sessionUid, session: frame.session! });
      return { frame, st, signals: readSignals(frame, st.signals) };
    };
    const place = ({ frame, st, signals }: ReturnType<typeof setup>) => {
      const out: StepOutput = { changed: new Set(), corrections: [] };
      identityUpdate.apply(frame, st, signals, out);
      return st.teammateCar;
    };

    it('the signals as read: the teammate is car 5', () => {
      expect(place(setup())).toBe(5);
    });
    it("numActiveCars of the signals leaves slot 5 unused: no teammate, whatever the frame's Participants count", () => {
      const s = setup();
      s.signals.session.numActiveCars = 5;
      expect([s.frame.participants!.numActiveCars, place(s)]).toEqual([6, undefined]);
    });
    it("the teammate's result status of the signals is inactive: no teammate, whatever the frame's LapData", () => {
      const s = setup();
      s.signals.cars[5]!.resultStatus = 'inactive';
      expect([s.frame.lapData!.lapData[5]!.resultStatus, place(s)]).toEqual([2, undefined]);
    });
  });
});
