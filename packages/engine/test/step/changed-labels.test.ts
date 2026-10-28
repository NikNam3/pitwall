// The change tags a sub-step reports (the scheduler picks calculators by them) and the session and tyre-set fields
// that the main tests leave at their defaults.
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { initialState, step, type ChangeTag, type Frame, type StepOutput } from '../../src/index.ts';
import { sessionStateFrom } from '../../src/step/session.ts';
import { applyTyres } from '../../src/step/tyres.ts';
import { buildPacket, ScenarioBuilder, type FrameDraft, type MenuSlot } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

const only = (tags: ChangeTag[]) => [...tags].sort();
const tagsOf = (frame: Frame): ChangeTag[] => {
  const out: StepOutput = { changed: new Set(), corrections: [] };
  applyTyres(initialState(initFor([frame])), frame, out);
  return only([...out.changed]);
};
/** One frame that carries only the named menu packets, plus what `extra` adds. */
const frameWith = (keep: MenuSlot[], extra: (d: FrameDraft) => void = () => {}): Frame =>
  new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
    for (const slot of ['lapData', 'motion', 'telemetry', 'status', 'motionEx'] as const) if (!keep.includes(slot)) d.drop(slot);
    extra(d);
  }).build()[0]!;

describe('tyres: change tags', () => {
  it.each([
    ['status', ['status'], ['status']],
    ['telemetry', ['telemetry'], ['telemetry']],
    ['status and telemetry', ['status', 'telemetry'], ['status', 'telemetry']],
    ['nothing', [], []],
  ] as const)('a frame with %s', (_, keep, expected) => {
    expect(tagsOf(frameWith([...keep]))).toEqual(only([...expected]));
  });
  it('Car Damage tags damage', () => {
    expect(tagsOf(frameWith([], (d) => { d.add('carDamage'); }))).toEqual(['damage']);
  });
  it('Tyre Sets tag tyreSets', () => {
    expect(tagsOf(frameWith([], (d) => { d.add('tyreSets', { carIdx: 0 }); }))).toEqual(['tyreSets']);
  });
  it('everything at once', () => {
    expect(tagsOf(frameWith(['status', 'telemetry'], (d) => { d.add('carDamage'); d.add('tyreSets', { carIdx: 0 }); }))).toEqual(only(['status', 'telemetry', 'damage', 'tyreSets']));
  });
});

describe('tyre sets', () => {
  it('available and fitted are read as flags, not as constants', () => {
    const frame = frameWith([], (d) => {
      d.add('tyreSets', { carIdx: 0, fittedIdx: 1, tyreSetData: { 0: { available: 1, fitted: 0 }, 1: { available: 0, fitted: 1 } } });
    });
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

  it('a frame with only Participants refreshes who is active', () => {
    const { st, results } = run((b) => b.participants({ numActiveCars: 2 }).frames(1, (d) => d.drop('lapData')));
    expect([results[1]!.changed.has('participants'), results[1]!.changed.has('timing')]).toEqual([true, false]);
    expect(st.cars.slice(0, 3).map((c) => c.active)).toEqual([true, true, false]);
  });
  it('a frame with only LapData refreshes who is active', () => {
    const { st, results } = run((b) => b.frames(1, (d) => { d.lapData.lapData[1]!.resultStatus = 0; }));
    expect([results[1]!.changed.has('participants'), results[1]!.changed.has('timing')]).toEqual([false, true]);
    expect(st.cars.slice(0, 3).map((c) => c.active)).toEqual([true, false, true]);
  });
});
