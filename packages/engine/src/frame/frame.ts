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

/** All packets of one game frame (spec 5.1), keyed by `overallFrameId`. */
export type Frame = {
  feedId: FeedId;
  sessionUid: bigint;
  /** The game's `frameIdentifier`; it goes back after a flashback. */
  frameId: number;
  /** The game's `overallFrameIdentifier`; it keeps rising across flashbacks. */
  overallFrameId: number;
  /** The latest header session time of the frame's packets. */
  sessionTime: SessionTime;
  /**
   * When the frame's first packet arrived (wall clock, ms, as the source stamped it; only compared, never read from a
   * clock): the situation tracker tells an offline pause and the post-session simulation by it.
   */
  receivedAtMs: number;
  /**
   * Set by the `SessionRunner` alone, which decides what a flashback is: the frame reports one (it rewound on it, or the
   * report repeats the last rewind's), so the situation tracker reads no session-time jump on it (spec 3.3).
   */
  flashbackReport?: true;
  playerCarIndex: number;
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
