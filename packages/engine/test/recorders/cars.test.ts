// The cars the recorders record (contract C10, C20, C43): the cars in the session are those whose car-status span is not
// `absent`, read from the situation the recorders get (C10, C20), never decided again from the live state: car-status is
// the one decider (C43). `carsWithLapData` narrows them to the cars whose LapData this frame carried.
import { describe, expect, it } from 'vitest';
import type { CarId, OpenSpan } from '@pitwall/domain';
import { carsInSession, carsWithLapData } from '../../src/recorders/cars.ts';
import type { Situation } from '../../src/situations/situation.ts';
import type { LiveState } from '../../src/state/live-state.ts';
import type { RecorderInput } from '../../src/step/types.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

/** The live state after one frame of four cars, all of them in the session by the game's fields (numActiveCars 4). */
const liveOfFourCars = (): LiveState => {
  const { st } = runScenario(new ScenarioBuilder({ cars: 4 }).frames(1, () => {}));
  const { open: _open, history: _history, weekend: _weekend, signals: _signals, log: _log, ...live } = st;
  return live;
};

/** A car-status span of car `carId`. */
const status = (carId: number, kind: 'competing' | 'retired' | 'disqualified' | 'absent'): OpenSpan => ({
  machine: 'car-status',
  id: 0,
  carId: carId as CarId,
  kind,
  start: 0,
  startFrame: 1,
  confirmed: true,
  detail: {},
});

/** The recorders' input of the frame: `live`, and the car-status spans `kinds` (by slot) as the situation. */
const inputOf = (live: LiveState, kinds: ReadonlyArray<'competing' | 'retired' | 'disqualified' | 'absent'>): RecorderInput => {
  const situation: Situation = { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: { 'car-status': live.cars.map((_, i) => status(i, kinds[i] ?? 'absent')) } };
  return { at: live.sessionTime, frameId: live.lastFrameId, frameNumber: 1, live, situation };
};

describe('the cars recorder records exactly the cars whose status is not absent (C43)', () => {
  it('competing, retired and disqualified cars are in the session; an absent slot is not', () => {
    const live = liveOfFourCars();
    expect(carsInSession(inputOf(live, ['competing', 'retired', 'disqualified', 'absent'])).map((c) => c.id)).toEqual([0, 1, 2]);
  });
  it('reads car-status from the situation, not the live state: a slot the game’s fields count is out when its status is absent', () => {
    const live = liveOfFourCars();
    expect(live.session.numActiveCars).toBe(4);
    expect(carsInSession(inputOf(live, ['competing', 'absent', 'competing', 'competing'])).map((c) => c.id)).toEqual([0, 2, 3]);
  });
  it('carsWithLapData: of the cars in the session, those whose LapData this frame carried', () => {
    const live = liveOfFourCars();
    const input = inputOf(live, ['competing', 'competing', 'absent', 'competing']);
    expect(carsWithLapData(input).map((c) => c.id)).toEqual([0, 1, 3]);
    expect(carsWithLapData({ ...input, at: input.at + 1 })).toEqual([]);
  });
});
