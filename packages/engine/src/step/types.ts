import type { CarId, Ms } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import type { EngineState } from '../state/engine-state.ts';

/** Every part of the state a frame can change; calculators and the scheduler read these. */
export const CHANGE_TAGS = [
  'session',
  'participants',
  'timing',
  'motion',
  'telemetry',
  'status',
  'damage',
  'setups',
  'motionEx',
  'tyreSets',
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

export type StepOutput = { changed: Set<ChangeTag>; corrections: LapCorrection[] };

/** One part of `step`: reads the frame, updates its part of the state and tags what it changed. */
export type SubStep = (state: EngineState, frame: Frame, out: StepOutput) => void;
