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

/** The session time fell from `fromMs` to `toMs` with no flashback and no start settling: nothing changes (spec 3.3). */
export type ClockFall = { fromMs: SessionTime; toMs: SessionTime };

/**
 * What a step did besides its tags. `rewritten`: it changed history recorded by earlier steps (lights out discarding
 * the formation lap, the start's settling re-stamping it), so readers start over and no rewind may go back before it.
 */
export type StepOutput = { changed: Set<ChangeTag>; corrections: LapCorrection[]; rewritten?: true; clockFall?: ClockFall };

/** One part of `step`: reads the frame, updates its part of the state and tags what it changed. */
export type SubStep = (state: EngineState, frame: Frame, out: StepOutput) => void;
