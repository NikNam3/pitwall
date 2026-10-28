// One car's state, grouped by domain (spec 6.1). `Known` appears only where the game can withhold a value
// (`restricted`, the spec's "Restricted data") or where it cannot apply (`notApplicable`); it is
// `notReceived` until the first packet.
import type { ActualCompound, VisualCompound } from './compounds.ts';
import type { Corners } from './corners.ts';
import type { CarId, DriverKey } from './ids.ts';
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
  gridPosition: number;
  speedTrapFastestKmh: Kmh | undefined;
  fiaFlag: FiaFlag;
};

export type TyreCorner = {
  surfaceTempC: Celsius;
  /** `notApplicable` when `settings.tyreTemperature` is `surfaceOnly`. */
  carcassTempC: Known<Celsius>;
  pressurePsi: Psi;
  wearPct: Known<Percent>;
  damagePct: Known<Percent>;
  blistersPct: Percent;
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
  brakes: Corners<{ tempC: Celsius; damagePct: Known<Percent> }>;
  engineTempC: Celsius;
};

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
  /** World position in m. */
  position: Vec3;
  /** World velocity in m/s. */
  velocity: Vec3;
  gForce: { lateral: number; longitudinal: number; vertical: number };
  orientation: { yawRad: Radians; pitchRad: Radians; rollRad: Radians };
};

export type OwnCarMotionEx = {
  wheels: Corners<{
    suspensionPosition: number;
    suspensionVelocity: number;
    suspensionAcceleration: number;
    speed: number;
    slipRatio: number;
    slipAngle: number;
    latForce: number;
    longForce: number;
    vertForce: number;
    camberRad: Radians;
    camberGainRad: Radians;
  }>;
  heightOfCogM: Metres;
  localVelocity: Vec3;
  angularVelocity: Vec3;
  angularAcceleration: Vec3;
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
  dynamics: CarDynamics;
  /** Player car only; moves when the player changes. */
  ownCar?: OwnCarState | undefined;
};
