// The change tags a sub-step reports (the scheduler picks calculators by them) and the session and tyre-set fields
// that the main tests leave at their defaults.
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { ALL_CHANGE_TAGS, CHANGE_TAGS, initialState, step, type ChangeTag, type Frame, type StepOutput, type SubStep } from '../../src/index.ts';
import { applyCondition } from '../../src/step/condition.ts';
import { applyDynamics } from '../../src/step/dynamics.ts';
import { applyEnergy } from '../../src/step/energy.ts';
import { applyIdentity } from '../../src/step/identity.ts';
import { applyOwnCar } from '../../src/step/own-car.ts';
import { applySession, sessionStateFrom } from '../../src/step/session.ts';
import { applyTiming } from '../../src/step/timing.ts';
import { applyTyres } from '../../src/step/tyres.ts';
import { buildPacket, ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

/** The optional packet fields of a frame: what a test keeps or removes to say "a frame with only these packets". */
const PACKETS = ['motion', 'lapData', 'telemetry', 'status', 'motionEx', 'session', 'damage', 'setups', 'participants'] as const;
type PacketField = (typeof PACKETS)[number] | 'tyreSets';

/** One frame that carries every packet, so any sub-step has something to read. */
const fullFrame = (): Frame =>
  new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
    d.add('carDamage');
    d.add('carSetups');
    d.add('tyreSets', { carIdx: 0 });
  }).build()[0]!;

/** The frame with only the named packets. */
const only = (frame: Frame, keep: readonly PacketField[]): Frame => {
  const bare: Frame = { ...frame, sessionHistory: [], tyreSets: keep.includes('tyreSets') ? frame.tyreSets : [], events: [] };
  for (const field of PACKETS) {
    if (keep.includes(field)) continue;
    Reflect.deleteProperty(bare, field);
  }
  return bare;
};

/** The tags `subStep` reports for `frame`, on a state that already took the full frame (so the player's own car exists). */
const tagsOf = (subStep: SubStep, keep: readonly PacketField[]): ChangeTag[] => {
  const full = fullFrame();
  const st = initialState(initFor([full]));
  step(st, full);
  const out: StepOutput = { changed: new Set(), corrections: [] };
  subStep(st, only(full, keep), out);
  return [...out.changed].sort();
};

describe('change tags', () => {
  it('are the domain areas, in this order', () => {
    expect(CHANGE_TAGS).toEqual([
      'session', 'identity', 'timing', 'tyres', 'energy', 'condition', 'dynamics', 'ownCar',
      'laps', 'stints', 'pitStops', 'flagPhases', 'events', 'miniSectors',
    ]);
  });
  it('ALL_CHANGE_TAGS is every tag once', () => {
    expect([...ALL_CHANGE_TAGS].sort()).toEqual([...CHANGE_TAGS].sort());
    expect(new Set(ALL_CHANGE_TAGS).size).toBe(CHANGE_TAGS.length);
  });
});

describe('sub-steps: each tags its own area, only when it wrote something', () => {
  it.each([
    ['applySession', applySession, ['session'], ['session']],
    ['applyIdentity', applyIdentity, ['participants'], ['identity']],
    ['applyTiming (LapData)', applyTiming, ['lapData'], ['timing']],
    ['applyTiming (the FIA flag from Car Status)', applyTiming, ['status'], ['timing']],
    ['applyTyres (compound and age from Car Status)', applyTyres, ['status'], ['tyres']],
    ['applyTyres (temperatures and pressures from Car Telemetry)', applyTyres, ['telemetry'], ['tyres']],
    ['applyTyres (wear, damage and blisters from Car Damage)', applyTyres, ['damage'], ['tyres']],
    ['applyTyres (Tyre Sets)', applyTyres, ['tyreSets'], ['tyres']],
    ['applyEnergy', applyEnergy, ['status'], ['energy']],
    ['applyCondition (Car Damage)', applyCondition, ['damage'], ['condition']],
    ['applyCondition (brake and engine temperatures from Car Telemetry)', applyCondition, ['telemetry'], ['condition']],
    ['applyDynamics (Car Telemetry)', applyDynamics, ['telemetry'], ['dynamics']],
    ['applyDynamics (Motion)', applyDynamics, ['motion'], ['dynamics']],
    ['applyDynamics (limits from Car Status)', applyDynamics, ['status'], ['dynamics']],
    ['applyOwnCar (MotionEx)', applyOwnCar, ['motionEx'], ['ownCar']],
    ['applyOwnCar (setup)', applyOwnCar, ['setups'], ['ownCar']],
    ['applyOwnCar (brake bias from Car Status)', applyOwnCar, ['status'], ['ownCar']],
  ] as const)('%s', (_, subStep, keep, expected) => {
    expect(tagsOf(subStep, keep)).toEqual([...expected]);
  });

  it.each([
    ['applySession', applySession],
    ['applyIdentity', applyIdentity],
    ['applyTiming', applyTiming],
    ['applyTyres', applyTyres],
    ['applyEnergy', applyEnergy],
    ['applyCondition', applyCondition],
    ['applyDynamics', applyDynamics],
    ['applyOwnCar', applyOwnCar],
  ] as const)('%s adds no tag for a frame without its packets', (_, subStep) => {
    expect(tagsOf(subStep, [])).toEqual([]);
  });

  it('a sub-step ignores the packets of the other areas', () => {
    expect(tagsOf(applyEnergy, ['lapData', 'motion', 'telemetry', 'motionEx', 'damage', 'setups', 'tyreSets'])).toEqual([]);
    expect(tagsOf(applyTiming, ['motion', 'telemetry', 'motionEx', 'damage', 'setups', 'tyreSets'])).toEqual([]);
    expect(tagsOf(applyTyres, ['lapData', 'motion', 'motionEx', 'setups'])).toEqual([]);
    expect(tagsOf(applyCondition, ['lapData', 'motion', 'status', 'motionEx', 'setups', 'tyreSets'])).toEqual([]);
    expect(tagsOf(applyDynamics, ['lapData', 'motionEx', 'damage', 'setups', 'tyreSets'])).toEqual([]);
    expect(tagsOf(applyOwnCar, ['lapData', 'motion', 'telemetry', 'damage', 'tyreSets'])).toEqual([]);
  });
});

describe('step: the tags of a whole frame', () => {
  const tagsOfStep = (keep: readonly PacketField[]): ChangeTag[] => {
    const full = fullFrame();
    const st = initialState(initFor([full]));
    step(st, full);
    return [...step(st, only(full, keep)).changed].sort();
  };

  it('a frame without packets sets no tag', () => {
    expect(tagsOfStep([])).toEqual([]);
  });
  it('Car Status alone tags every area it feeds', () => {
    expect(tagsOfStep(['status'])).toEqual(['dynamics', 'energy', 'ownCar', 'timing', 'tyres']);
  });
  it('Car Telemetry alone tags tyres, condition and dynamics', () => {
    expect(tagsOfStep(['telemetry'])).toEqual(['condition', 'dynamics', 'tyres']);
  });
  it('Car Damage alone tags tyres and condition', () => {
    expect(tagsOfStep(['damage'])).toEqual(['condition', 'tyres']);
  });
  it('Motion alone tags dynamics', () => {
    expect(tagsOfStep(['motion'])).toEqual(['dynamics']);
  });
  it('LapData alone tags timing', () => {
    expect(tagsOfStep(['lapData'])).toEqual(['timing']);
  });
  it('MotionEx and Car Setups alone tag ownCar', () => {
    expect(tagsOfStep(['motionEx', 'setups'])).toEqual(['ownCar']);
  });
  it('Session and Participants alone tag session and identity', () => {
    expect(tagsOfStep(['session', 'participants'])).toEqual(['identity', 'session']);
  });
});

describe('tyre sets', () => {
  it('available and fitted are read as flags, not as constants', () => {
    const frame = new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      d.add('tyreSets', { carIdx: 0, fittedIdx: 1, tyreSetData: { 0: { available: 1, fitted: 0 }, 1: { available: 0, fitted: 1 } } });
    }).build()[0]!;
    const st = initialState(initFor([frame]));
    step(st, frame);
    const sets = st.cars[0]!.tyres.sets;
    expect(sets.known && sets.value.sets.slice(0, 2).map((s) => [s.available, s.fitted])).toEqual([[true, false], [false, true]]);
  });
});

describe('session fields', () => {
  const state = (o: Parameters<typeof buildPacket<'session'>>[1]) => sessionStateFrom(buildPacket('session', o), 0);

  it('the on/off switches read as booleans, both ways', () => {
    const on = state({ pitLaneTyreSim: 0, parcFermeRules: 1, equalCarPerformance: 1, formationLap: 1, networkGame: 1 });
    const off = state({ pitLaneTyreSim: 1, parcFermeRules: 0, equalCarPerformance: 0, formationLap: 0, networkGame: 0 });
    expect([on.settings.pitLaneTyreSim, on.settings.parcFerme, on.settings.equalCarPerformance, on.settings.formationLap, on.networkGame]).toEqual([true, true, true, true, true]);
    expect([off.settings.pitLaneTyreSim, off.settings.parcFerme, off.settings.equalCarPerformance, off.settings.formationLap, off.networkGame]).toEqual([false, false, false, false, false]);
  });
  it('the pit window', () => {
    expect(state({ pitStopWindowIdealLap: 18, pitStopWindowLatestLap: 24, pitStopRejoinPosition: 7 }).pitWindow).toEqual({ idealLap: 18, latestLap: 24, rejoinPosition: 7 });
  });
  it('the weekend structure is as long as the number of sessions in the weekend', () => {
    expect(state({ numSessionsInWeekend: 3, weekendStructure: { 0: 1, 1: 8, 2: 15, 3: 16, 4: 17 } }).weekendStructure).toEqual([1, 8, 15]);
  });
});

describe('step: which cars are active', () => {
  const run = (arrange: (b: ScenarioBuilder) => ScenarioBuilder) => {
    const frames = arrange(new ScenarioBuilder({ cars: 3 }).frames(1, () => {})).build();
    const st = initialState({ feedId: 'test' as FeedId, sessionUid: frames[0]!.sessionUid, session: frames[0]!.session! });
    const results = frames.map((f) => step(st, f));
    return { st, results };
  };

  it('a frame with only Participants (no LapData, no Car Status) refreshes who is active', () => {
    const { st, results } = run((b) => b.participants({ numActiveCars: 2 }).frames(1, (d) => { d.drop('lapData'); d.drop('status'); }));
    expect([results[1]!.changed.has('identity'), results[1]!.changed.has('timing')]).toEqual([true, false]);
    expect(st.cars.slice(0, 3).map((c) => c.active)).toEqual([true, true, false]);
  });
  it('a frame with only LapData refreshes who is active', () => {
    const { st, results } = run((b) => b.frames(1, (d) => { d.lapData.lapData[1]!.resultStatus = 0; }));
    expect([results[1]!.changed.has('identity'), results[1]!.changed.has('timing')]).toEqual([false, true]);
    expect(st.cars.slice(0, 3).map((c) => c.active)).toEqual([true, false, true]);
  });
});
