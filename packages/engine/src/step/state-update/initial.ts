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
import { newHistory } from '../../log/projection.ts';
import type { ProjectionBook } from '../../log/types.ts';
import { initialSignals } from '../../signals/read.ts';
import { STEP0_CLOCK } from '../../situations/clock/clock.ts';
import { emptySituation } from '../../situations/situation.ts';
import type { EngineState, OpenTrackers } from '../../state/engine-state.ts';
import type { WeekendContext } from '../../state/weekend-context.ts';
import { RECORDERS } from '../step.ts';
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
    gapToLeaderMs: unknown('notReceived'),
    gapToCarAheadMs: unknown('notReceived'),
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
    confirmedLaps: [],
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

/** Nothing opened yet: every recorder's own state as its `init` gives it. */
const emptyTrackers = (lastFlag: OpenTrackers['lastFlag'], projection: ProjectionBook): OpenTrackers => ({
  situations: { session: { kind: 'preStart', start: toSessionTime(0), startLeaderLap: 0 } },
  phaseBook: { started: false },
  clock: STEP0_CLOCK.init(),
  lastFlag,
  recorders: Object.fromEntries(RECORDERS.map((recorder) => [recorder.id, recorder.init()])),
  machines: {},
  projection,
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
  const { log, projection, book } = newHistory(emptySituation());
  const state: EngineState = {
    feedId: init.feedId,
    sessionUid: sessionUidString(init.sessionUid),
    session,
    cars: Array.from({ length: MAX_CARS }, (_, i) => createCarState(carId(i))),
    log,
    history: projection,
    signals: initialSignals(init.session),
    frameEvents: [],
    playerCar: carId(header.playerCarIndex),
    lastFrameId: header.frameIdentifier,
    frameNumber: 0,
    sessionTime: toSessionTime(header.sessionTime),
    open: emptyTrackers(session.flag, book),
    realism: init.realism ?? false,
    masking: { player: carId(header.playerCarIndex), teammate: undefined, realism: init.realism ?? false },
    ...(init.weekend && { weekend: init.weekend }),
  };
  placePlayer(state, header.playerCarIndex);
  state.masking = { player: state.playerCar, teammate: state.teammateCar, realism: state.realism };
  return state;
}
