import type { CarId, Ms, SessionTime } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import type { EngineState } from '../state/engine-state.ts';

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
export type RewindMark = { frameId: number; rawMs: SessionTime; lastWallMs: number };

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
 * unconfirmed; a session phase opening or closing at a moment an earlier frame was stamped at, which moves that frame's
 * entries across the boundary), so readers start over; rewinds across it stay exact.
 */
export type StepOutput = {
  changed: Set<ChangeTag>;
  corrections: LapCorrection[];
  rewritten?: true;
  discarded?: true;
  clockFall?: ClockFall;
  clockJump?: ClockJump;
};

/** One part of `step`: reads the frame, updates its part of the state and tags what it changed. */
export type SubStep = (state: EngineState, frame: Frame, out: StepOutput) => void;
