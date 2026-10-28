import type { DriverKey, LapRecord, PitStopRecord, SessionUid, StintRecord } from '@pitwall/domain';

/**
 * The player's earlier sessions of this weekend with every driver's records in them: read-only input the bridge loads
 * from storage (spec 9.3). `sessions` are oldest first; `drivers` are ordered by car id.
 */
export type WeekendContext = {
  weekendId: string;
  /** The player. */
  driverKey: DriverKey;
  sessions: Array<{
    sessionUid: SessionUid;
    sessionType: number;
    drivers: Array<{ driverKey: DriverKey; laps: LapRecord[]; stints: StintRecord[]; pitStops: PitStopRecord[] }>;
  }>;
};
