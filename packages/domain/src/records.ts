// History entries (spec 6.3): append-only facts about the session.
import type { DamageParts } from './analyses/damage.ts';
import type { ActualCompound, VisualCompound } from './compounds.ts';
import type { Corners } from './corners.ts';
import type { CarId, SessionTime } from './ids.ts';
import type { Known } from './known.ts';
import type { Joules, Kg, Ms, Percent, Ratio } from './units.ts';

/** The lowest and highest value a channel had over a span, e.g. one lap. */
export type Range = { min: number; max: number };

/** Per-lap min and max of every band channel (spec A.1), collected by the engine's lap cursor; `unknown` when no frame of the lap had the value. */
export type ChannelRange = {
  tyres: Corners<{ surfaceC: Known<Range>; carcassC: Known<Range>; pressurePsi: Known<Range> }>;
  brakesC: Corners<Known<Range>>;
  engineC: Known<Range>;
};

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
  // Sampled at the lap end from the car state of the frame that completes the lap (spec 3.3, A.1).
  wearAtEndPct: Corners<Known<Percent>>;
  ersStoreAtEndJ: Known<Joules>;
  /** Deployed during this lap. */
  ersDeployedJ: Known<Joules>;
  /** MGU-K + MGU-H, harvested during this lap. */
  ersHarvestedJ: Known<Joules>;
  damageAtEnd: Known<DamageParts>;
  /** Min and max of every band channel over the lap. */
  channelRange: ChannelRange;
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
  | 'lightsOut'
  /** Recorded by the engine, not sent by the game: a damage part rose between two frames (params: `DamageChangeParams`). */
  | 'damageChange';

/** The `params` of a `damageChange` event: which part rose, from and to what. A fall (a repair) is no event. */
export type DamageChangeParams = { part: keyof DamageParts; fromPct: Percent; toPct: Percent };

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
