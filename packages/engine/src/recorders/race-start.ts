// The race start and the session's end as a recorder reads them (contract C10, C11, C20): from the race's session-phase
// spans in the situation, with its own mark of the kind it saw on the previous frame (each recorder keeps its own copy,
// C11). The race start is the frame `racing` opens from the start lights that followed the grid or the formation lap
// (not a red flag's standing restart): there every car's lap starts over from its start (spec 3.2), what a recorder
// tracked through the formation lap starts over, and a car in the pit lane starts from it, which is no pit stop.
import type { Situation } from '../situations/situation.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** The sub-machines whose `postSession` span ends the session for a recorder (C17: one per weekend phase). */
const SESSION_PHASES = ['session-phase-race', 'session-phase-qualifying', 'session-phase-practice'] as const;
const RACE_PHASES = 'session-phase-race';

/**
 * What a recorder keeps to see the race start: the kind of the race's session-phase span on the previous frame, and
 * whether the start lights in progress are the race's start (not a restart after a red flag).
 */
export type RaceStartMark = { kind: string | undefined; startLights: boolean };

export const initialRaceStartMark = (): RaceStartMark => ({ kind: undefined, startLights: false });

/** The mark after this frame's situation, and whether this frame is the race start. */
export const raceStartStep = (mark: DeepReadonly<RaceStartMark>, situation: Situation): { mark: RaceStartMark; started: boolean } => {
  const kind = situation.byMachine[RACE_PHASES]?.[0]?.kind;
  const startLights = kind === 'startLights' ? (mark.kind === 'startLights' ? mark.startLights : mark.kind !== 'suspended') : false;
  const started = kind === 'racing' && mark.kind === 'startLights' && mark.startLights;
  return { mark: { kind, startLights }, started };
};

/** The session's end phase opened on this frame (`frameNumber`, C26): a `postSession` span of the weekend phase's machine. */
export const postSessionOpened = (situation: Situation, frameNumber: number): boolean =>
  SESSION_PHASES.some((machine) => situation.byMachine[machine]?.some((s) => s.kind === 'postSession' && s.startFrame === frameNumber));
