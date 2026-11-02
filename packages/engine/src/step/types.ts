// Protocol-free (C6): recorders and the bridge import these types; `SubStep` (`sub-step.ts`) and `StateUpdate`
// (`state-update/types.ts`) hold the frame.
import type { CarId, Ms, SessionTime, Stamp } from '@pitwall/domain';
import type { LogWriter } from '../log/types.ts';
import type { Situation } from '../situations/situation.ts';
import type { LiveState } from '../state/live-state.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** Every part of the state a frame can change; calculators and the scheduler read these. */
export const CHANGE_TAGS = [
  'session',
  'identity',
  'timing',
  'tyres',
  'energy',
  'condition',
  'dynamics',
  'ownCar',
  /** A session phase opened, closed or changed (`history.sessionPhases`, `open.situations`). */
  'sessionPhases',
  'laps',
  'stints',
  'pitStops',
  'flagPhases',
  'events',
  'miniSectors',
] as const;
export type ChangeTag = (typeof CHANGE_TAGS)[number];
/** Every change tag, each once: what a flashback changes. */
export const ALL_CHANGE_TAGS: readonly ChangeTag[] = CHANGE_TAGS;

/** A provisional lap value that the game's Session History replaced with the confirmed one. */
export type LapCorrection = {
  carId: CarId;
  lapNumber: number;
  field: 'lapTimeMs' | 'sector1Ms' | 'sector2Ms';
  provisional: Ms;
  confirmed: Ms;
};

/**
 * The game's session time fell from `fromMs` to `toMs` with no flashback and no start settling (spec 3.3): nothing
 * recorded changes, and from the race start on the race clock continues over the fall (user ruling 2026-10-30).
 */
export type ClockFall = { fromMs: SessionTime; toMs: SessionTime };

/**
 * The game's session time jumped forward from `fromMs` to `toMs` by more than `SIMULATION_JUMP_MS` with no post-session
 * simulation (a stall while the clock runs ahead of wall time in the garage): nothing changes; it is only reported
 * (spec 3.3).
 */
export type ClockJump = { fromMs: SessionTime; toMs: SessionTime };

/** What a rewind needs to know of the state it leaves: its frame id, the game's session time and its last wall time. */
export type RewindMark = { frameId: number; rawMs: SessionTime; lastWallMs: number | undefined };

/**
 * The `SessionRunner`'s decision that a frame reports a flashback, the one way it reaches the situation tracker: no
 * session-time jump is read on the frame (spec 3.3). `rewound` when the runner rewound on it: the mark of the state it
 * left. The runner keeps the decision with the frame and gives it again whenever a later rewind replays the frame, so
 * the replay does what the first pass did.
 */
export type FlashbackReport = { rewound?: RewindMark };

/**
 * What a step did besides its tags. `rewritten`: it changed history recorded by earlier steps (lights out discarding
 * the formation lap, the start's settling re-stamping it), so readers start over and no rewind may go back before it.
 * `discarded`: it took back what readers already saw without changing the history (a neutralisation dropped
 * unconfirmed; a session phase opening or closing at or before the time of an entry an earlier frame recorded, which
 * moves that entry across the boundary), so readers start over; rewinds across it stay exact.
 */
export type StepOutput = {
  changed: Set<ChangeTag>;
  corrections: LapCorrection[];
  rewritten?: true;
  discarded?: true;
  clockFall?: ClockFall;
  clockJump?: ClockJump;
};

/** A step-3 module (C10): reads the live state, the situations and its own open state; appends facts to the log. */
export type Recorder<Own> = {
  id: string;
  init(): Own;
  apply(input: DeepReadonly<RecorderInput>, own: Own, log: LogWriter, out: StepOutput): Own;
};
export type RecorderInput = { at: SessionTime; frameId: number; live: LiveState; situation: Situation; stamps: FrameStamps };
/** This frame's stamps (C26): a car's fact carries `{ ...session, ...cars[carId] }`; zone spans are never stamped. */
export type FrameStamps = { session: Stamp; cars: readonly Stamp[] };
