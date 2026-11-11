// What car-activity-race reads of one car on one frame (contract C9, C12, C13, C15): its upstream spans (car-location,
// car-status, penalties), its signals (pitStatus, resultStatus) and its timing values, gathered once per car. Holds the
// two choices of a kind that need no history: the activity at the lights out and the current activity (a join, a return
// from notCompeting). Facts: docs/research/09-situations-inventory.md §2.5, §2.7, §2.10.
import { carId as toCarId, type CarId, type OpenSpan,type PitStatus, type ResultStatus, type ServingPenaltyDetail } from '@pitwall/domain';
import type { CarSignals } from '../../signals/types.ts';
import { carSpanIn } from '../../util/car-span.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import type { MachineInput } from '../machine.ts';

export type Kind = 'racingLap' | 'inLap' | 'boxStop' | 'servingPenalty' | 'outLap' | 'finished' | 'coolDown' | 'notCompeting';
export type Location = 'garage' | 'pitLane' | 'track';

/** The upstream sub-machines car-activity-race reads (C15). */
export const CAR_LOCATION = 'car-location';
export const CAR_STATUS = 'car-status';
export const PENALTIES = 'penalties';
export const SESSION_PHASE = 'session-phase-race';

/** The penalties kinds that owe a penalty served in the pit lane, and the penalty each names. */
const SERVED_IN_PIT_LANE: Readonly<Record<string, ServingPenaltyDetail['penalty']>> = { driveThroughPending: 'driveThrough', stopGoPending: 'stopGo' };

/** One car on one frame, as the machine reads it. `competing` is undefined while the car has no car-status span (C3). */
export type CarView = {
  carId: CarId;
  competing: boolean | undefined;
  location: Location | undefined;
  /** The penalty to serve in the pit lane, with the penalties span that owes it; undefined when none is owed. */
  owed: ServingPenaltyDetail | undefined;
  pitStatus: PitStatus;
  resultStatus: ResultStatus;
  lap: number;
  lapDistanceM: number;
  pitStopTimerMs: number;
};

const spanOf = (input: DeepReadonly<MachineInput>, machine: string, carId: CarId): DeepReadonly<OpenSpan> | undefined => carSpanIn(input.upstream[machine], carId);

/** Car slot `index` on this frame; none while the live state holds no car in the slot. */
export const carView = (input: DeepReadonly<MachineInput>, index: number, signals: DeepReadonly<CarSignals>): CarView | undefined => {
  const timing = input.live.cars[index]?.timing;
  if (timing === undefined) return undefined;
  const carId = toCarId(index);
  const status = spanOf(input, CAR_STATUS, carId);
  const penalties = spanOf(input, PENALTIES, carId);
  const penalty = penalties === undefined ? undefined : SERVED_IN_PIT_LANE[penalties.kind];
  return {
    carId,
    competing: status === undefined ? undefined : status.kind === 'competing',
    location: spanOf(input, CAR_LOCATION, carId)?.kind as Location | undefined,
    owed: penalty === undefined || penalties === undefined ? undefined : { penalty, given: { machine: PENALTIES, carId, spanId: penalties.id } },
    pitStatus: signals.pitStatus,
    resultStatus: signals.resultStatus,
    lap: timing.lap,
    lapDistanceM: timing.lapDistanceM,
    pitStopTimerMs: timing.pitStopTimerMs,
  };
};

/** The activity a car opens at the lights out: a car in the pit lane starts from it (outLap), every other car racingLap. */
export const lightsOutKind = (car: CarView): Kind => {
  if (car.competing !== true) return 'notCompeting';
  return car.location === 'pitLane' ? 'outLap' : 'racingLap';
};

/**
 * What a car is doing now, from this frame alone: not competing notCompeting; finished coolDown; in the pit lane
 * servingPenalty while a drive-through or stop-go is owed, else boxStop in its box, else outLap past it (the pit stop
 * timer above 0), else inLap; otherwise racingLap.
 */
export const currentKind = (car: CarView): Kind => {
  if (car.competing !== true) return 'notCompeting';
  if (car.resultStatus === 'finished') return 'coolDown';
  if (car.location !== 'pitLane') return 'racingLap';
  if (car.owed !== undefined) return 'servingPenalty';
  if (car.pitStatus === 'inPitArea') return 'boxStop';
  return car.pitStopTimerMs > 0 ? 'outLap' : 'inLap';
};

/** The kind a pit entry opens: servingPenalty while a drive-through or stop-go is owed, else inLap. */
export const entryKind = (car: CarView): Kind => (car.owed === undefined ? 'inLap' : 'servingPenalty');
