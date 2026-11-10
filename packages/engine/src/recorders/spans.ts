// The machine's open spans as the recorders read them (contract C10, C13, C20, C43): a car's activity (the weekend
// phase's activity sub-machine), location and lap validity, the session's neutralisation and its end. Each reader takes the frame's
// situation and decides nothing again: the kinds are the machine's. Protocol-free and signal-free (C6, C13).
import type { CarId, NeutralisedDetail, OpenSpan } from '@pitwall/domain';
import type { Situation } from '../situations/situation.ts';
import { carSpanIn } from '../util/car-span.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** The car-activity sub-machines (C17: one per weekend phase); at most one runs in a session, none under `pending` or `none`. */
const ACTIVITY_MACHINES = ['car-activity-race', 'car-activity-qualifying', 'car-activity-practice'] as const;
/** The race's car-activity sub-machine: the only one with box stops and penalty visits. */
export const RACE_ACTIVITY = 'car-activity-race';
/** The session-phase sub-machines (C17: one per weekend phase). */
const SESSION_PHASES = ['session-phase-race', 'session-phase-qualifying', 'session-phase-practice'] as const;
const RACE_PHASES = 'session-phase-race';
const CAR_LOCATION = 'car-location';
const LAP_VALIDITY = 'lap-validity';

/** A span as a recorder reads it from the situation. */
export type SituationSpan = DeepReadonly<OpenSpan>;

const carSpan = (situation: Situation, machine: string, carId: CarId): SituationSpan | undefined => carSpanIn(situation.byMachine[machine], carId);

/** The car's open activity span, of whichever activity sub-machine runs; none before its scope begins or without one. */
export const activityOf = (situation: Situation, carId: CarId): SituationSpan | undefined => {
  for (const machine of ACTIVITY_MACHINES) {
    const span = carSpan(situation, machine, carId);
    if (span !== undefined) return span;
  }
  return undefined;
};

/** The car's lap does not count on this frame: its lap-validity span is `invalid`. */
export const lapInvalid = (situation: Situation, carId: CarId): boolean => carSpan(situation, LAP_VALIDITY, carId)?.kind === 'invalid';

/** The car's open car-location span (`garage`, `pitLane`, `track`). */
export const locationOf = (situation: Situation, carId: CarId): SituationSpan | undefined => carSpan(situation, CAR_LOCATION, carId);

/** The car neutralising the session (`SC` or `VSC`) while the race's `neutralised` span is open; none otherwise. */
export const neutralisedBy = (situation: Situation): NeutralisedDetail['car'] | undefined => {
  const span = situation.byMachine[RACE_PHASES]?.[0];
  return span?.kind === 'neutralised' ? (span.detail as DeepReadonly<NeutralisedDetail>).car : undefined;
};

/**
 * The session was over before this frame (frame number `frameNumber`): a `postSession` span of the weekend phase's
 * session-phase sub-machine opened on an earlier frame. The frame the session ends on still carries its last LapData.
 */
export const sessionOver = (situation: Situation, frameNumber: number): boolean =>
  SESSION_PHASES.some((machine) => situation.byMachine[machine]?.some((span) => span.kind === 'postSession' && span.startFrame < frameNumber));

/** The activity kinds during which no lap is recorded: the car cools down after the flag, or competes no more (ruling 4). */
const NO_LAP_KINDS: ReadonlySet<string> = new Set(['coolDown', 'notCompeting']);

/** No lap of the car is recorded on this frame: its activity is `coolDown` or `notCompeting`, or the session was over before it. */
export const recordsNoLap = (situation: Situation, carId: CarId, frameNumber: number): boolean => {
  const kind = activityOf(situation, carId)?.kind;
  return (kind !== undefined && NO_LAP_KINDS.has(kind)) || sessionOver(situation, frameNumber);
};

/** The car's race activity opened `finished` on this frame (frame number `frameNumber`): it took the chequered flag. */
export const finishOpened = (activity: SituationSpan | undefined, frameNumber: number): boolean =>
  activity?.machine === RACE_ACTIVITY && activity.kind === 'finished' && activity.startFrame === frameNumber;

/** The push kinds of the timed activities: the lap from the line after an out lap. */
const PUSH_KINDS: ReadonlySet<string> = new Set(['pushLap', 'flyingLap']);

/** The car's activity opened a push or flying lap on this frame (frame number `frameNumber`): the timed lap starts at the line. */
export const pushOpened = (activity: SituationSpan | undefined, frameNumber: number): boolean =>
  activity !== undefined && PUSH_KINDS.has(activity.kind) && activity.startFrame === frameNumber && activity.joinedAt !== true;

/** The car's activity opened a pit entry on this frame: an `inLap` or a `servingPenalty` span (race), the timed `inLap`. */
export const pitEntryOpened = (activity: SituationSpan | undefined, frameNumber: number): boolean =>
  activity !== undefined && (activity.kind === 'inLap' || activity.kind === 'servingPenalty') && activity.startFrame === frameNumber;
