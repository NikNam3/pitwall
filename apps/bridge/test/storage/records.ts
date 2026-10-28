import { ActualCompound, VisualCompound, known, type CarId, type DriverKey, type FlagPhase, type LapRecord, type RaceEvent, type SessionUid, type StintRecord } from '@pitwall/domain';
import type { History, HistoryDelta, HistoryLengths } from '@pitwall/engine';
import type { SessionRow } from '../../src/storage/db.ts';
export const car = (n: number) => n as CarId;
export const lap = (c: number, n: number, o: Partial<LapRecord> = {}): LapRecord => ({ carId: car(c), lapNumber: n, lapTimeMs: 90_000,
  sectorTimesMs: [30_000, 30_000, 30_000], valid: { lap: true, sectors: [true, true, true] }, actualCompound: ActualCompound.C3,
  visualCompound: VisualCompound.medium, tyreAgeAtStart: n - 1, fuelAtStartKg: known(10, 0), fuelAtEndKg: known(9, 90_000), scShare: 0,
  vscShare: 0, inLap: false, outLap: false, positionAtEnd: 1, status: 'confirmed', completedAt: n * 90_000, ...o });
export const stint = (c: number, firstLap: number): StintRecord => ({ carId: car(c), firstLap, lastLap: firstLap + 9,
  actualCompound: ActualCompound.C3, visualCompound: VisualCompound.medium, tyreAgeAtFitting: 0 });
export const event = (at: number, c?: number): RaceEvent => ({ at, kind: 'overtake', ...(c === undefined ? {} : { carId: car(c) }), params: {} });
export const sc = (start: number): FlagPhase => ({ kind: 'SC', start, end: start + 60_000, startLeaderLap: 3, endLeaderLap: 5, scPhases: [] });
export const history = (o: Partial<History> = {}): History => ({ laps: [], stints: [], pitStops: [], flagPhases: [], events: [], miniSectors: [], ...o });
const lengths = (h: History): HistoryLengths => ({ laps: h.laps.length, stints: h.stints.length, pitStops: h.pitStops.length,
  flagPhases: h.flagPhases.length, events: h.events.length, miniSectors: h.miniSectors.length });
export const all = (h: History): HistoryDelta => ({ before: lengths(history()), after: lengths(h), truncated: false });
export const since = (prev: History, h: History, truncated = false): HistoryDelta => ({ before: lengths(prev), after: lengths(h), truncated });
export const AI9: DriverKey = { kind: 'ai', driverId: 9 };
export const HUMAN: DriverKey = { kind: 'human', networkId: 1, name: 'Driver One', raceNumber: 2 };
export const session = (uid: string, o: Partial<SessionRow> = {}): SessionRow => ({ sessionUid: uid as SessionUid, weekendId: 'W1', seasonId: 'S1',
  sessionType: 1, trackId: 26, startedAt: '2026-10-27T20:00:00.000Z', pwrecPath: `/rec/${uid}.pwrec.gz`, settings: { tyreTemperature: 1 },
  drivers: [{ carId: car(0), driverKey: AI9 }, { carId: car(1), driverKey: HUMAN }], ...o });
