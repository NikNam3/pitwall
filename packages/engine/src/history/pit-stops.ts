import type { CarState, SessionState, SessionTime } from '@pitwall/domain';
import type { EngineState, OpenPitVisit } from '../state/engine-state.ts';
import type { SubStep } from '../step/types.ts';
import { carsWithLapData } from './cars.ts';

const flagOf = (flag: SessionState['flag']): OpenPitVisit['flag'] => (flag === 'sc' || flag === 'vsc' ? flag : 'green');

const openVisit = (state: EngineState, car: CarState, at: SessionTime): void => {
  state.open.pitVisits[car.id] = {
    lap: car.timing.lap,
    entry: at,
    flag: flagOf(state.session.flag),
    penaltyServed: false,
    pitLaneTimeMs: 0,
    stationaryTimeMs: 0,
  };
  const cursor = state.open.laps[car.id];
  if (cursor) cursor.pitted = true;
};

const closeVisit = (state: EngineState, car: CarState, visit: OpenPitVisit, at: SessionTime): void => {
  state.history.pitStops.push({
    carId: car.id,
    lap: visit.lap,
    pitLaneEntry: visit.entry,
    pitLaneExit: at,
    // The game's pit lane timer, or the observed duration when it never ran.
    pitLaneTimeMs: visit.pitLaneTimeMs > 0 ? visit.pitLaneTimeMs : at - visit.entry,
    stationaryTimeMs: visit.stationaryTimeMs,
    flag: visit.flag,
    penaltyServed: visit.penaltyServed,
  });
  state.open.pitVisits[car.id] = undefined;
};

/**
 * A pit visit runs from an observed change of the pit status away from `none` to the change back. Leaving the garage
 * (the first status seen is already not `none`) is no visit.
 */
export const applyPitStops: SubStep = (state, frame, out) => {
  const before = state.history.pitStops.length;
  const at = frame.sessionTime;
  for (const { details } of frame.events) {
    if (details.code !== 'DTSV' && details.code !== 'SGSV') continue;
    const visit = state.open.pitVisits[details.vehicleIdx];
    if (visit) visit.penaltyServed = true;
  }
  for (const car of carsWithLapData(state, frame)) {
    const { pitStatus, pitLaneTimeMs, pitStopTimerMs } = car.timing;
    const previous = state.open.pitStatus[car.id];
    state.open.pitStatus[car.id] = pitStatus;
    if (previous === 'none' && pitStatus !== 'none') openVisit(state, car, at);
    const visit = state.open.pitVisits[car.id];
    if (!visit) continue;
    visit.pitLaneTimeMs = Math.max(visit.pitLaneTimeMs, pitLaneTimeMs);
    visit.stationaryTimeMs = Math.max(visit.stationaryTimeMs, pitStopTimerMs);
    if (pitStatus === 'none') closeVisit(state, car, visit, at);
  }
  if (state.history.pitStops.length > before) out.changed.add('pitStops');
};
