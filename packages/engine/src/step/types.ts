import type { CarId, Ms } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import type { EngineState } from '../state/engine-state.ts';

/** The part of the state a frame changed; calculators and the scheduler read these. */
export type ChangeTag =
  | 'session'
  | 'participants'
  | 'timing'
  | 'motion'
  | 'telemetry'
  | 'status'
  | 'damage'
  | 'setups'
  | 'motionEx'
  | 'tyreSets'
  | 'laps'
  | 'stints'
  | 'pitStops'
  | 'flagPhases'
  | 'events'
  | 'miniSectors';

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
