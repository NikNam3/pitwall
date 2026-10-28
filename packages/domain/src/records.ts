// History entries (spec 6.3): append-only facts about the session.
import type { ActualCompound, VisualCompound } from './compounds.ts';
import type { CarId, SessionTime } from './ids.ts';
import type { Known } from './known.ts';
import type { Kg, Ms, Ratio } from './units.ts';

export type LapRecord = {
  carId: CarId;
  lapNumber: number;
  lapTimeMs: Ms;
  sectorTimesMs: [Ms, Ms, Ms];
  valid: { lap: boolean; sectors: [boolean, boolean, boolean] };
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  tyreAgeAtStart: number;
  fuelAtStartKg: Known<Kg>;
  fuelAtEndKg: Known<Kg>;
  scShare: Ratio;
  vscShare: Ratio;
  inLap: boolean;
  outLap: boolean;
  positionAtEnd: number;
  /** `provisional` from LapData, `confirmed` once SessionHistory contains the lap. */
  status: 'provisional' | 'confirmed';
  completedAt: SessionTime;
};

export type StintRecord = {
  carId: CarId;
  firstLap: number;
  lastLap: number;
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  tyreAgeAtFitting: number;
};

export type PitStopRecord = {
  carId: CarId;
  lap: number;
  pitLaneEntry: SessionTime;
  pitLaneExit: SessionTime;
  pitLaneTimeMs: Ms;
  stationaryTimeMs: Ms;
  flag: 'green' | 'sc' | 'vsc';
  penaltyServed: boolean;
};

export type ScPhase = { phase: 'deployed' | 'returning' | 'returned' | 'resume'; at: SessionTime };

/** A neutralised or stopped part of the session; a red phase ends at the next lights out, an SC restart or the session end. */
export type FlagPhase = {
  kind: 'SC' | 'VSC' | 'red';
  start: SessionTime;
  end: SessionTime;
  startLeaderLap: number;
  endLeaderLap: number;
  scPhases: ScPhase[];
};

export type RaceEventKind =
  | 'penalty'
  | 'overtake'
  | 'collision'
  | 'retirement'
  | 'fastestLap'
  | 'speedTrap'
  | 'drsEnabled'
  | 'drsDisabled'
  | 'startLights'
  | 'lightsOut';

/** One object type for every kind; the details live in `params`. */
export type RaceEvent = {
  at: SessionTime;
  kind: RaceEventKind;
  carId?: CarId;
  otherCarId?: CarId;
  params: Record<string, number | string>;
};

/** The lap is split into this many segments of equal length by distance. */
export const MINI_SECTORS = 50;

/** When a car crossed the end of a mini-sector, interpolated between frames. */
export type MiniSectorCrossing = { carId: CarId; lap: number; segment: number; at: SessionTime };
