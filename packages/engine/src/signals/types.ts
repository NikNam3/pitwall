// The signals (contract C12, C13): the closed list of game fields and events that state a status, permission, obligation
// or transition. Step 1 writes them, only the machine reads them; no signal reaches the live state, a fact or a topic.
// Protocol-free and in domain units (C4): step 1 converts the packets into these.
import type { CarId, DriverStatus, FiaFlag, Ms, NeutralisedStage, PitStatus, ResultStatus, SessionFlag, SessionState, SessionTime } from '@pitwall/domain';

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

/** RTMT's reason, in the game's code order. */
export type RetirementReason =
  | 'invalid'
  | 'retired'
  | 'finished'
  | 'terminalDamage'
  | 'inactive'
  | 'notEnoughLapsCompleted'
  | 'blackFlagged'
  | 'redFlagged'
  | 'mechanicalFailure'
  | 'sessionSkipped'
  | 'sessionSimulated';
/** DRSD's reason, in the game's code order. */
export type DrsDisabledReason = 'wetTrack' | 'safetyCar' | 'redFlag' | 'minLapNotReached' | 'unknown';

/**
 * A C12 event of the frame (BUTN is ignored; OVTK, COLL, FTLP and SPTP are values, `FrameEvent`), converted by step 1:
 * times in ms, a car as `CarId` (`undefined` where the game sends 255, no car).
 */
export type SituationEvent =
  | { code: 'SSTA' }
  | { code: 'SEND' }
  | { code: 'CHQF' }
  | { code: 'LGOT' }
  | { code: 'RDFL' }
  | { code: 'DRSE' }
  | { code: 'DRSD'; reason: DrsDisabledReason }
  | { code: 'STLG'; lights: number }
  /** `car` from `safetyCarType` (0 none, 1 SC, 2 VSC, 3 formation lap), `stage` from `eventType`. */
  | { code: 'SCAR'; car: 'none' | 'SC' | 'VSC' | 'formation'; stage: NeutralisedStage }
  | { code: 'RCWN'; carId: CarId | undefined }
  | { code: 'RTMT'; carId: CarId | undefined; reason: RetirementReason }
  /** `penaltyType` and `infringementType` are the game's codes; `timeMs` is `undefined` where the game sends 255 (no time). */
  | {
      code: 'PENA';
      carId: CarId | undefined;
      otherCarId: CarId | undefined;
      penaltyType: number;
      infringementType: number;
      timeMs: Ms | undefined;
      lap: number;
      placesGained: number;
    }
  | { code: 'DTSV'; carId: CarId | undefined }
  | { code: 'SGSV'; carId: CarId | undefined; stopTimeMs: Ms }
  | { code: 'TMPT'; carId: CarId | undefined }
  /** The flashback's target: the game's frame identifier and the game's session time (not the race clock; only step 0 reads it, C7). */
  | { code: 'FLBK'; targetFrameId: number; targetSessionTime: SessionTime };
/** The event codes that are signals (C12). */
export type SituationEventCode = SituationEvent['code'];

/** What step 1 writes for the machine: per car (indexed by `CarId`), the session, and the frame's C12 events. */
export type Signals = { cars: CarSignals[]; session: SessionSignals; events: SituationEvent[] };
