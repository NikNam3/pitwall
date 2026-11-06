// History entries (spec 6.3): append-only facts about the session.
import type { DamageParts } from './analyses/damage.ts';
import type { ActualCompound, VisualCompound } from './compounds.ts';
import type { Corners } from './corners.ts';
import type { FactRef, FrameNumber } from './facts.ts';
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
  /** On a confirmed lap: the provisional lap record it supersedes (its fact id in the log, C21, C25); absent when this session's log holds no provisional of the lap. */
  supersedes?: FactRef;
  /**
   * Sampled at the lap start from the car state of the frame that starts the lap; `unknown('notReceived')` for a lap the
   * engine joined after its start. With the lap-end samples they give the lap's own wear and ERS change (rates per lap).
   */
  wearAtStartPct: Corners<Known<Percent>>;
  ersStoreAtStartJ: Known<Joules>;
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
  /** The frame the record describes (C26): the frame that completed the lap. */
  frame: FrameNumber;
};

export type StintRecord = {
  carId: CarId;
  firstLap: number;
  lastLap: number;
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  tyreAgeAtFitting: number;
  /** The frame the record describes (C26). */
  frame: FrameNumber;
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
  /** The frame the record describes (C26). */
  frame: FrameNumber;
};

/**
 * A penalty race control gave a car (the glossary's penalty record), recorded from the `penalties` sub-machine's spans,
 * never from a signal (C13): one record per added drive-through, stop-go or time penalty. `infringement` is unknown when
 * no PENA explained it (C3); `timeMs` is set for a time penalty only. `frame`: the frame its span opened on (C26).
 */
export type PenaltyRecord = {
  carId: CarId;
  kind: 'driveThrough' | 'stopGo' | 'time';
  infringement: Known<number>;
  timeMs: Ms | undefined;
  at: SessionTime;
  frame: FrameNumber;
};

export type RaceEventKind =
  | 'overtake'
  | 'collision'
  | 'fastestLap'
  | 'speedTrap'
  /** Recorded by the engine, not sent by the game: a damage part changed between two frames (params: `DamageChangeParams`). */
  | 'damageChange';

/** The `params` of a `damageChange` event: which part changed, from and to what. A rise is a hit; a fall is a repair (a part change in the pits). */
export type DamageChangeParams = { part: keyof DamageParts; fromPct: Percent; toPct: Percent };

/** One object type for every kind; the details live in `params`. */
export type RaceEvent = {
  at: SessionTime;
  kind: RaceEventKind;
  carId?: CarId;
  otherCarId?: CarId;
  params: Record<string, number | string>;
  /** The frame the record describes (C26). */
  frame: FrameNumber;
};

/**
 * A game event of the frame that is a value, not a signal (OVTK, COLL, FTLP, SPTP): written into the live state by step 1
 * (`LiveState.frameEvents`), so no recorder reads a packet (C6). Times and speeds in domain units.
 */
export type FrameEvent = {
  kind: 'overtake' | 'collision' | 'fastestLap' | 'speedTrap';
  carId?: CarId;
  otherCarId?: CarId;
  params: Record<string, number | string>;
};

/** The lap is split into this many segments of equal length by distance. */
export const MINI_SECTORS = 50;

/**
 * When a car passed the boundary of mini-sector `segment` of lap `lap`, interpolated between frames. Segment s's
 * boundary is at `s × trackLength / 50`, so segment 0 is the start/finish line at the start of the lap, and the line
 * that completes lap L is `(L + 1, 0)`.
 */
export type MiniSectorCrossing = {
  carId: CarId;
  lap: number;
  segment: number;
  at: SessionTime;
  frame: FrameNumber;
  /** On a crossing of a restarted lap: the earlier crossing of the same car, lap and segment (its fact id in the log, C21, C25). */
  supersedes?: FactRef;
};

/**
 * A decision the user committed (C76), appended by the decision recorder describing the frame it was committed at (C10,
 * C26). It names the choice, never the values (C23): `calibrationChosen` names the set (`null` for `defaults`) and the
 * priors snapshot it chose (`null` without one, C62a); the snapshot's entries live in the priors sidecar.
 */
export type DecisionRecord = { kind: 'calibrationChosen'; setId: string | null; snapshot: string | null; frame: FrameNumber };
