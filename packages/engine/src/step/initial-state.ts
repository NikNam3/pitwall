import {
  carId,
  MAX_CARS,
  sessionUidString,
  toSessionTime,
  unknown,
  type CarId,
  type CarState,
  type Corners,
  type FeedId,
  type Vec3,
} from '@pitwall/domain';
import type { SessionPacket } from '@pitwall/protocol';
import type { EngineState, History, OpenTrackers } from '../state/engine-state.ts';
import type { WeekendContext } from '../state/weekend-context.ts';
import { placePlayer } from './identity.ts';
import { sessionStateFrom } from './session.ts';

const corners = <T>(make: () => T): Corners<T> => ({ fl: make(), fr: make(), rl: make(), rr: make() });
const origin = (): Vec3 => ({ x: 0, y: 0, z: 0 });

/** A car nothing is known about yet: unknown data is `notReceived`, everything else 0 or false. */
export const createCarState = (id: CarId): CarState => ({
  id,
  active: false,
  identity: {
    name: '',
    teamId: 255,
    raceNumber: 0,
    nationality: 0,
    ai: true,
    driverId: 255,
    networkId: 255,
    myTeam: false,
    platform: 255,
    telemetryPublic: false,
    driverKey: { kind: 'ai', driverId: 255 },
    visibility: 'public',
  },
  timing: {
    position: 0,
    lap: 0,
    lapDistanceM: 0,
    totalDistanceM: 0,
    currentLapTimeMs: 0,
    lastLapTimeMs: 0,
    sector: 1,
    sector1TimeMs: 0,
    sector2TimeMs: 0,
    currentLapInvalid: false,
    gapToLeaderMs: 0,
    gapToCarAheadMs: 0,
    safetyCarDeltaMs: 0,
    pitStatus: 'none',
    numPitStops: 0,
    pitLaneTimerActive: false,
    pitLaneTimeMs: 0,
    pitStopTimerMs: 0,
    shouldServePenalty: false,
    driverStatus: 'inGarage',
    // Assumed until the first LapData, so the car is not taken for inactive.
    resultStatus: 'active',
    timePenaltyMs: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    unservedDriveThroughs: 0,
    unservedStopGos: 0,
    // 0 until the first LapData; from there on 1 for pole.
    gridPosition: 0,
    speedTrapFastestKmh: unknown('notReceived'),
    fiaFlag: 'unknown',
  },
  tyres: {
    actualCompound: 'unknown',
    visualCompound: 'unknown',
    age: 0,
    corners: corners(() => ({
      surfaceTempC: unknown('notReceived'),
      carcassTempC: unknown('notReceived'),
      pressurePsi: unknown('notReceived'),
      wearPct: unknown('notReceived'),
      damagePct: unknown('notReceived'),
      blistersPct: unknown('notReceived'),
    })),
    sets: unknown('notReceived'),
  },
  energy: { fuel: unknown('notReceived'), ers: unknown('notReceived'), power: unknown('notReceived') },
  condition: {
    bodywork: unknown('notReceived'),
    powerUnit: unknown('notReceived'),
    drsFault: unknown('notReceived'),
    ersFault: false,
    engineBlown: false,
    engineSeized: false,
    brakes: corners(() => ({ tempC: unknown('notReceived'), damagePct: unknown('notReceived') })),
    engineTempC: unknown('notReceived'),
  },
  motion: {
    position: origin(),
    velocityMps: origin(),
    gForce: { lateral: 0, longitudinal: 0, vertical: 0 },
    orientation: { yawRad: 0, pitchRad: 0, rollRad: 0 },
  },
  dynamics: unknown('notReceived'),
  updatedAt: {},
});

const emptyHistory = (): History => ({ laps: [], stints: [], pitStops: [], flagPhases: [], events: [], miniSectors: [] });

const perCar = <T>(make: () => T): T[] => Array.from({ length: MAX_CARS }, make);

/** Nothing opened yet; per-car arrays hold `MAX_CARS` entries. */
const emptyTrackers = (lastFlag: OpenTrackers['lastFlag']): OpenTrackers => ({
  laps: perCar(() => undefined),
  stints: perCar(() => undefined),
  pitVisits: perCar(() => undefined),
  lastFlag,
  miniSectors: perCar(() => undefined),
  lapIndex: perCar(() => ({})),
  pitStatus: perCar(() => undefined),
});

/** The state at the start of a session: the first Session packet is known, every car's data is not. */
export function initialState(init: {
  feedId: FeedId;
  sessionUid: bigint;
  session: SessionPacket;
  weekend?: WeekendContext;
  realism?: boolean;
}): EngineState {
  const { header } = init.session;
  const session = sessionStateFrom(init.session, 0);
  const state: EngineState = {
    feedId: init.feedId,
    sessionUid: sessionUidString(init.sessionUid),
    session,
    cars: Array.from({ length: MAX_CARS }, (_, i) => createCarState(carId(i))),
    history: emptyHistory(),
    playerCar: carId(header.playerCarIndex),
    lastFrameId: header.frameIdentifier,
    sessionTime: toSessionTime(header.sessionTime),
    open: emptyTrackers(session.flag),
    realism: init.realism ?? false,
    ...(init.weekend && { weekend: init.weekend }),
  };
  placePlayer(state, header.playerCarIndex);
  return state;
}
