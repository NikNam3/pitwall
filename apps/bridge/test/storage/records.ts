import { ActualCompound, VisualCompound, known, unknown, type CarId, type DriverKey, type LapRecord, type PitStopRecord, type RaceEvent, type SessionUid, type StintRecord } from '@pitwall/domain';
import type { HistoryDelta, LogLengths, Projection } from '@pitwall/engine';
import type { SessionKey, SessionRow } from '../../src/storage/db.ts';
export const car = (n: number) => n as CarId;
const none = unknown('notReceived');
const corners = <T>(v: T) => ({ fl: v, fr: v, rl: v, rr: v });
/** The lap-start and lap-end samples, all unknown: storage keeps them as JSON like the rest of the record. */
const lapEnd = { wearAtStartPct: corners(none), ersStoreAtStartJ: none, wearAtEndPct: corners(none), ersStoreAtEndJ: none, ersDeployedJ: none, ersHarvestedJ: none, damageAtEnd: none,
  channelRange: { tyres: corners({ surfaceC: none, carcassC: none, pressurePsi: none }), brakesC: corners(none), engineC: none } };
export const lap = (c: number, n: number, o: Partial<LapRecord> = {}): LapRecord => ({ carId: car(c), lapNumber: n, lapTimeMs: 90_000,
  sectorTimesMs: [30_000, 30_000, 30_000], valid: { lap: true, sectors: [true, true, true] }, actualCompound: ActualCompound.C3,
  visualCompound: VisualCompound.medium, tyreAgeAtStart: n - 1, fuelAtStartKg: known(10, 0), fuelAtEndKg: known(9, 90_000), scShare: 0,
  vscShare: 0, inLap: false, outLap: false, positionAtEnd: 1, status: 'confirmed', completedAt: n * 90_000, ...lapEnd, frame: 0, ...o });
export const stint = (c: number, firstLap: number): StintRecord => ({ carId: car(c), firstLap, lastLap: firstLap + 9,
  actualCompound: ActualCompound.C3, visualCompound: VisualCompound.medium, tyreAgeAtFitting: 0, frame: 0 });
export const pitStop = (c: number, lap: number): PitStopRecord => ({ carId: car(c), lap, pitLaneEntry: lap * 90_000, pitLaneExit: lap * 90_000 + 22_000,
  pitLaneTimeMs: 22_000, stationaryTimeMs: 2_500, flag: 'green', penaltyServed: false, frame: 0 });
export const event = (at: number, c?: number): RaceEvent => ({ at, kind: 'overtake', ...(c === undefined ? {} : { carId: car(c) }), params: {}, frame: 0 });
export const history = (o: Partial<Projection> = {}): Projection => ({ laps: [], stints: [], pitStops: [], events: [], crossings: [], penalties: [], clock: [], spans: {}, ...o });
const lengths = (h: Projection): LogLengths => ({ laps: h.laps.length, stints: h.stints.length, pitStops: h.pitStops.length,
  events: h.events.length,
  crossings: h.crossings.length });
export const all = (h: Projection): HistoryDelta => ({ before: lengths(history()), after: lengths(h) });
export const since = (prev: Projection, h: Projection, rewound = false): HistoryDelta => ({ before: lengths(prev), after: lengths(h), ...(rewound ? { rewound: { frameId: -1, at: 0 } } : {}) });
/** Two drivers, by name and network id (Task 24: no AI or human kind): an AI driver (network id 255) and a human. */
export const AI9: DriverKey = { name: 'DRIVER 9', networkId: 255 };
export const HUMAN: DriverKey = { name: 'Driver One', networkId: 1 };
/** A session row; its session type is the weekend phase as text (`weekendPhaseText`, Task 24), a practice by default. */
export const session = (uid: string, o: Partial<SessionRow> = {}): SessionRow => ({ sessionUid: uid as SessionUid, weekendId: 'W1', seasonId: 'S1',
  sessionType: 'practice:practice:1', trackId: 26, startedAt: '2026-10-27T20:00:00.000Z', pwrecPath: `/rec/${uid}.pwrec.gz`, settings: { tyreTemperature: 1 },
  drivers: [{ carId: car(0), driverKey: AI9 }, { carId: car(1), driverKey: HUMAN }], ...o });
/** The storage key of `session(uid, { weekendId })`. */
export const key = (uid: string, weekendId = 'W1'): SessionKey => ({ sessionUid: uid as SessionUid, weekendId });
