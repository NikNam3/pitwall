import type { FeedId, SessionTime } from '@pitwall/domain';
import type {
  CarDamagePacket,
  CarSetupsPacket,
  CarStatusPacket,
  CarTelemetryPacket,
  EventPacket,
  FinalClassificationPacket,
  LapDataPacket,
  LapPositionsPacket,
  MotionExPacket,
  MotionPacket,
  ParticipantsPacket,
  SessionHistoryPacket,
  SessionPacket,
  TimeTrialPacket,
  TyreSetsPacket,
} from '@pitwall/protocol';

/** The packets the game sends on every frame; a closed frame without one of them lost a packet. */
export const MENU_RATE_SLOTS = ['lapData', 'motion', 'telemetry', 'status', 'motionEx'] as const;

/** All packets of one game tick (spec 5.1, C5), keyed by `overallFrameId` and `frameId`. */
export type Frame = {
  feedId: FeedId;
  sessionUid: bigint;
  /** The game's `frameIdentifier`; it goes back after a flashback. */
  frameId: number;
  /** The game's `overallFrameIdentifier`; it keeps rising across flashbacks, and the two ticks of a flashback share it. */
  overallFrameId: number;
  /** The latest header session time of the tick's packets other than events; of its events when it has only those. */
  sessionTime: SessionTime;
  /**
   * When the frame's first packet arrived (wall clock, ms, as the source stamped it; only compared, never read from a
   * clock): step 0's clock tells an offline pause and the post-session simulation by it.
   */
  receivedAtMs: number;
  playerCarIndex: number;
  /** The frame's first FLBK event, as the game's target frame id and session time (ms): what the `SessionRunner` reads. */
  flashback?: { targetFrameId: number; targetSessionTime: SessionTime };
  motion?: MotionPacket;
  lapData?: LapDataPacket;
  telemetry?: CarTelemetryPacket;
  status?: CarStatusPacket;
  motionEx?: MotionExPacket;
  session?: SessionPacket;
  damage?: CarDamagePacket;
  setups?: CarSetupsPacket;
  participants?: ParticipantsPacket;
  lapPositions?: LapPositionsPacket;
  finalClassification?: FinalClassificationPacket;
  timeTrial?: TimeTrialPacket;
  sessionHistory: SessionHistoryPacket[];
  tyreSets: TyreSetsPacket[];
  events: EventPacket[];
};
