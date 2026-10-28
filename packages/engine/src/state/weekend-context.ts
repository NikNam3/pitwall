import type { DriverKey, LapRecord, PitStopRecord, SessionUid, StintRecord } from '@pitwall/domain';

/** The same driver's earlier sessions of this weekend: read-only input the bridge loads from storage (spec 9.3). */
export type WeekendContext = {
  weekendId: string;
  driverKey: DriverKey;
  sessions: Array<{
    sessionUid: SessionUid;
    sessionType: number;
    laps: LapRecord[];
    stints: StintRecord[];
    pitStops: PitStopRecord[];
  }>;
};
