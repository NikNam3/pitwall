// One car's state, grouped by domain (spec 6.1). `Known` appears only where the game can withhold a value
// (`restricted`, the spec's "Restricted data") or where it cannot apply (`notApplicable`); it is
// `notReceived` until the first packet.
import type { ActualCompound, VisualCompound } from './compounds.ts';
import type { Corners } from './corners.ts';
import type { DataSource } from './freshness.ts';
import type { CarId, DriverKey, SessionTime } from './ids.ts';
import type { Known } from './known.ts';
import type { ZoneFlag } from './session.ts';
import type { Celsius, Joules, Kg, Kmh, Metres, Ms, Percent, Psi, Radians, Ratio, Watts } from './units.ts';

export type Visibility = 'own' | 'public' | 'restricted';
export type PitStatus = 'none' | 'pitting' | 'inPitArea';
export type DriverStatus = 'inGarage' | 'flyingLap' | 'inLap' | 'outLap' | 'onTrack';
export type FiaFlag = ZoneFlag;
export type ResultStatus =
  | 'invalid'
  | 'inactive'
  | 'active'
  | 'finished'
  | 'didNotFinish'
  | 'disqualified'
  | 'notClassified'
  | 'retired';
export type Vec3 = { x: number; y: number; z: number };

export type CarIdentity = {
  name: string;
  teamId: number;
  raceNumber: number;
  nationality: number;
  ai: boolean;
  driverId: number;
  networkId: number;
  myTeam: boolean;
  platform: number;
  /** Participants `yourTelemetry = 1`. */
  telemetryPublic: boolean;
  driverKey: DriverKey;
  visibility: Visibility;
};

export type CarTiming = {
  position: number;
  lap: number;
  lapDistanceM: Metres;
  totalDistanceM: Metres;
  currentLapTimeMs: Ms;
  lastLapTimeMs: Ms;
  sector: 1 | 2 | 3;
  sector1TimeMs: Ms;
  sector2TimeMs: Ms;
  currentLapInvalid: boolean;
  gapToLeaderMs: Ms;
  gapToCarAheadMs: Ms;
  safetyCarDeltaMs: Ms;
  pitStatus: PitStatus;
  numPitStops: number;
  pitLaneTimerActive: boolean;
  pitLaneTimeMs: Ms;
  pitStopTimerMs: Ms;
  shouldServePenalty: boolean;
  driverStatus: DriverStatus;
  resultStatus: ResultStatus;
  timePenaltyMs: Ms;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  unservedDriveThroughs: number;
  unservedStopGos: number;
  /** Grid position counting from 1 (pole is 1), as the race position does; 0 until the first LapData. */
  gridPosition: number;
  /** Fastest speed-trap value of the car; `notReceived` until it has one. */
  speedTrapFastestKmh: Known<Kmh>;
  fiaFlag: FiaFlag;
};

export type TyreCorner = {
  surfaceTempC: Known<Celsius>;
  /** `notApplicable` when `settings.tyreTemperature` is `surfaceOnly`. */
  carcassTempC: Known<Celsius>;
  pressurePsi: Known<Psi>;
  wearPct: Known<Percent>;
  damagePct: Known<Percent>;
  blistersPct: Known<Percent>;
};

export type TyreSet = {
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  wearPct: Percent;
  available: boolean;
  fitted: boolean;
  recommendedSession: number;
  lifeSpanLaps: number;
  usableLifeLaps: number;
  lapDeltaMs: Ms;
};

export type CarTyres = {
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  age: number;
  corners: Corners<TyreCorner>;
  sets: Known<{ sets: TyreSet[]; fittedIdx: number }>;
};

export type CarEnergy = {
  fuel: Known<{ kg: Kg; capacityKg: Kg; remainingLaps: number; mix: 'lean' | 'standard' | 'rich' | 'max' }>;
  ers: Known<{
    storeJ: Joules;
    mode: 'none' | 'medium' | 'hotlap' | 'overtake';
    harvestedMgukJ: Joules;
    harvestedMguhJ: Joules;
    deployedJ: Joules;
  }>;
  power: Known<{ iceW: Watts; mgukW: Watts }>;
};

export type CarCondition = {
  bodywork: Known<{
    frontLeftWingPct: Percent;
    frontRightWingPct: Percent;
    rearWingPct: Percent;
    floorPct: Percent;
    diffuserPct: Percent;
    sidepodPct: Percent;
  }>;
  powerUnit: Known<{
    engineDamagePct: Percent;
    gearboxDamagePct: Percent;
    mguhWearPct: Percent;
    esWearPct: Percent;
    ceWearPct: Percent;
    iceWearPct: Percent;
    mgukWearPct: Percent;
    tcWearPct: Percent;
  }>;
  drsFault: Known<boolean>;
  ersFault: boolean;
  engineBlown: boolean;
  engineSeized: boolean;
  brakes: Corners<{ tempC: Known<Celsius>; damagePct: Known<Percent> }>;
  engineTempC: Known<Celsius>;
};

/** Driving inputs from Car Telemetry, limits from Car Status. */
export type CarDynamics = {
  speedKmh: Kmh;
  throttle: Ratio;
  brake: Ratio;
  /** -1 (full left) to 1 (full right). */
  steer: number;
  clutchPct: Percent;
  /** -1 = reverse, 0 = neutral. */
  gear: number;
  rpm: number;
  maxRpm: number;
  revLightsPct: Percent;
  drs: boolean;
  drsAllowed: boolean;
  drsActivationDistanceM: Metres;
  pitLimiter: boolean;
};

/** World motion from the Motion packet. */
export type CarMotion = {
  /** World position in m. */
  position: Vec3;
  /** World velocity in m/s. */
  velocityMps: Vec3;
  gForce: { lateral: number; longitudinal: number; vertical: number };
  orientation: { yawRad: Radians; pitchRad: Radians; rollRad: Radians };
};

export type OwnCarMotionEx = {
  wheels: Corners<{
    /** Unit not stated in the F1 25 spec. */
    suspensionPosition: number;
    /** Unit not stated in the F1 25 spec. */
    suspensionVelocity: number;
    /** Unit not stated in the F1 25 spec. */
    suspensionAcceleration: number;
    /** Wheel speed. Unit not stated in the F1 25 spec. */
    speed: number;
    /** Unit not stated in the F1 25 spec. */
    slipRatio: number;
    /** Unit not stated in the F1 25 spec. */
    slipAngle: number;
    /** Unit not stated in the F1 25 spec. */
    latForce: number;
    /** Unit not stated in the F1 25 spec. */
    longForce: number;
    /** Unit not stated in the F1 25 spec. */
    vertForce: number;
    camberRad: Radians;
    camberGainRad: Radians;
  }>;
  heightOfCogM: Metres;
  /** Local velocity in m/s. */
  localVelocityMps: Vec3;
  /** Angular velocity in rad/s. */
  angularVelocityRadPerS: Vec3;
  /** Angular acceleration in rad/s^2. */
  angularAccelerationRadPerS2: Vec3;
  frontWheelsAngleRad: Radians;
  frontAeroHeightM: Metres;
  rearAeroHeightM: Metres;
  frontRollAngleRad: Radians;
  rearRollAngleRad: Radians;
  chassisYawRad: Radians;
  chassisPitchRad: Radians;
};

/** Setup-screen values as the game sends them (camber and toe in degrees). */
export type CarSetup = {
  frontWing: number;
  rearWing: number;
  diffOnThrottlePct: Percent;
  diffOffThrottlePct: Percent;
  frontCamber: number;
  rearCamber: number;
  frontToe: number;
  rearToe: number;
  frontSuspension: number;
  rearSuspension: number;
  frontAntiRollBar: number;
  rearAntiRollBar: number;
  frontRideHeight: number;
  rearRideHeight: number;
  brakePressurePct: Percent;
  brakeBiasPct: Percent;
  engineBrakingPct: Percent;
  tyrePressurePsi: Corners<Psi>;
  ballast: number;
  fuelLoadKg: Kg;
};

/** Data the game sends for the player's car only. */
export type OwnCarState = {
  motionEx: Known<OwnCarMotionEx>;
  setup: Known<CarSetup>;
  /** Live value from Car Status. */
  brakeBiasPct: Known<Percent>;
};

export type CarState = {
  id: CarId;
  active: boolean;
  identity: CarIdentity;
  timing: CarTiming;
  tyres: CarTyres;
  energy: CarEnergy;
  condition: CarCondition;
  motion: CarMotion;
  /** `notReceived` until Car Telemetry arrives; hidden in realism mode. */
  dynamics: Known<CarDynamics>;
  /** Session time of the last frame whose packet of each source carried data for this car; a source never received has no entry. */
  updatedAt: Partial<Record<DataSource, SessionTime>>;
  /** Player car only; moves when the player changes. */
  ownCar?: OwnCarState | undefined;
};
