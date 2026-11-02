// The signals (contract C12, C13): the closed list of game fields and events that state a status, permission, obligation
// or transition. Step 1 writes them, only the machine reads them; no signal reaches the live state, a fact or a topic.
import type { CarId, DriverStatus, FiaFlag, Ms, PitStatus, ResultStatus, SessionFlag, SessionState } from '@pitwall/domain';
import type { EventDetailsOf } from '@pitwall/protocol';

/** Every signal of C12, by the name its field has in `CarSignals`, `SessionSignals` or `Signals`. */
export type SignalKey =
  | 'pitStatus'
  | 'driverStatus'
  | 'pitLaneTimerActive'
  | 'resultStatus'
  | 'numPitStops'
  | 'shouldServePenalty'
  | 'unservedDriveThroughs'
  | 'unservedStopGos'
  | 'timePenaltyMs'
  | 'totalWarnings'
  | 'cornerCuttingWarnings'
  | 'currentLapInvalid'
  | 'fiaFlag'
  | 'drsAllowed'
  | 'networkPaused'
  | 'aiControlled'
  | 'safetyCarStatus'
  | 'marshalZones'
  | 'periods'
  | 'sessionType'
  | 'weekendStructure'
  | 'ruleSet'
  | 'gamePaused'
  | 'isSpectating'
  | 'spectatorCarIndex'
  | 'numActiveCars'
  | 'events';

/** One car's signals (C12: LapData, CarStatus, Participants `aiControlled`), in domain units. */
export type CarSignals = {
  pitStatus: PitStatus;
  driverStatus: DriverStatus;
  pitLaneTimerActive: boolean;
  resultStatus: ResultStatus;
  numPitStops: number;
  /** `pitStopShouldServePen`. */
  shouldServePenalty: boolean;
  /** `numUnservedDriveThroughPens`. */
  unservedDriveThroughs: number;
  /** `numUnservedStopGoPens`. */
  unservedStopGos: number;
  /** `penalties`: the time penalties accumulated. */
  timePenaltyMs: Ms;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  currentLapInvalid: boolean;
  /** `vehicleFIAFlags`. */
  fiaFlag: FiaFlag;
  drsAllowed: boolean;
  networkPaused: boolean;
  aiControlled: boolean;
};

/** The session's signals (C12: Session, Participants `numActiveCars`), in domain units. */
export type SessionSignals = {
  safetyCarStatus: SessionFlag;
  marshalZones: SessionState['marshalZones'];
  /** `numSafetyCarPeriods`, `numVirtualSafetyCarPeriods`, `numRedFlagPeriods`. */
  periods: { sc: number; vsc: number; red: number };
  sessionType: number;
  /** The session types of the weekend; its length is `numSessionsInWeekend`. */
  weekendStructure: number[];
  ruleSet: number;
  gamePaused: boolean;
  isSpectating: boolean;
  /** `undefined` when the game sends no spectated car (255). */
  spectatorCarIndex: CarId | undefined;
  numActiveCars: number;
};

/** The event codes that are signals (C12). BUTN is ignored; OVTK, COLL, FTLP and SPTP are values (`FrameEvent`). */
export type SituationEventCode =
  | 'SSTA'
  | 'SCAR'
  | 'STLG'
  | 'LGOT'
  | 'RDFL'
  | 'CHQF'
  | 'RCWN'
  | 'SEND'
  | 'RTMT'
  | 'DRSE'
  | 'DRSD'
  | 'PENA'
  | 'DTSV'
  | 'SGSV'
  | 'TMPT'
  | 'FLBK';
/** A C12 event of the frame with its decoded details. */
export type SituationEvent = EventDetailsOf<SituationEventCode>;

/** What step 1 writes for the machine: per car (indexed by `CarId`), the session, and the frame's C12 events. */
export type Signals = { cars: CarSignals[]; session: SessionSignals; events: SituationEvent[] };
