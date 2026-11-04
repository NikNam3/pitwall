// Facts, logs and session rows for the storage tests (Task 27: storage holds each session's log, C24, C60).
import { ActualCompound, VisualCompound, known, unknown, type CarId, type CarKey, type LapRecord, type MachineId, type PitStopRecord, type RaceEvent, type SessionUid, type Span, type StintRecord, type VoidFact } from '@pitwall/domain';
import type { EngineState, Projection } from '@pitwall/engine';
import type { Db, SessionKey, SessionRow } from '../../src/storage/db.ts';

/** The log as the engine keeps it (C21): one list per fact type, the void facts and one span list per sub-machine. */
export type Log = EngineState['log'];

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
export const stint = (c: number, firstLap: number, o: Partial<StintRecord> = {}): StintRecord => ({ carId: car(c), firstLap, lastLap: firstLap + 9,
  actualCompound: ActualCompound.C3, visualCompound: VisualCompound.medium, tyreAgeAtFitting: 0, frame: 0, ...o });
export const pitStop = (c: number, lap: number, o: Partial<PitStopRecord> = {}): PitStopRecord => ({ carId: car(c), lap, pitLaneEntry: lap * 90_000,
  pitLaneExit: lap * 90_000 + 22_000, pitLaneTimeMs: 22_000, stationaryTimeMs: 2_500, flag: 'green', penaltyServed: false, frame: 0, ...o });
export const event = (at: number, c?: number, frame = 0): RaceEvent => ({ at, kind: 'overtake', ...(c === undefined ? {} : { carId: car(c) }), params: {}, frame });

/** A closed span of `machine`; frames 1 to 10 by default (C26: it covers `startFrame <= f < endFrame`). */
export const span = (machine: MachineId, kind: string, o: Partial<Span> = {}): Span => ({ machine, id: 0, kind, start: 0, end: 1_000,
  confirmed: true, detail: {}, startFrame: 1, endFrame: 10, ...o });

/** A log with every list empty, `o`'s lists in place (arrays the test may push to: the log only grows, C24). */
export const log = (o: Partial<Log> = {}): Log => ({ laps: [], stints: [], pitStops: [], crossings: [], events: [], penalties: [], clock: [], voids: [], spans: {}, ...o });

/** A flashback's void fact (C27): the frame restored to and, per list, the log positions that never happened. */
export const voidFact = (ranges: VoidFact['ranges'], frame = 5): VoidFact => ({ target: { frameId: frame, at: frame * 100 }, ranges, frame });

/** The projection of a log without void facts or a formation span: its lists as they are (C28). */
export const projected = ({ voids: _voids, ...lists }: Log): Projection => lists;

/** A projection with every list empty, `o`'s lists in place. */
export const history = (o: Partial<Projection> = {}): Projection => ({ laps: [], stints: [], pitStops: [], events: [], crossings: [], penalties: [], clock: [], spans: {}, ...o });

/** Cars by team and race number (C62); no driver name, no network id (user, 2026-11-04). */
export const MERCEDES_44: CarKey = { teamId: 0, raceNumber: 44 };
export const FERRARI_16: CarKey = { teamId: 1, raceNumber: 16 };
export const ASTON_14: CarKey = { teamId: 4, raceNumber: 14 };

/** A session row: a practice of weekend W1 whose feed's player is car 1 (FERRARI_16), car 0 MERCEDES_44. */
export const session = (uid: string, o: Partial<SessionRow> = {}): SessionRow => ({ sessionUid: uid as SessionUid, weekendId: 'W1', seasonId: 'S1',
  playerCar: car(1), trackId: 26, startedAt: '2026-10-27T20:00:00.000Z', pwrecPath: `/rec/${uid}.pwrec.gz`, settings: { tyreTemperature: 1 },
  cars: [{ carId: car(0), carKey: MERCEDES_44 }, { carId: car(1), carKey: FERRARI_16 }], ...o });

/** The storage key of a session (C60): its uid, its weekend and its feed's player car. */
export const key = (uid: string, weekendId = 'W1', playerCar = car(1)): SessionKey => ({ sessionUid: uid as SessionUid, weekendId, playerCar });
export const keyOf = (row: SessionRow): SessionKey => ({ sessionUid: row.sessionUid, weekendId: row.weekendId, playerCar: row.playerCar });

/** A row as `sessionsOf` returns it: the row written, its rules version and whether its log is complete. */
export const stored = (row: SessionRow, complete: boolean, rulesVersion = 'unversioned') => ({ ...row, rulesVersion, complete });

/** The fact rows of a session as stored, in list and position order, each record parsed. */
export const factRows = (db: Db, k: SessionKey): Array<{ list: string; seq: number; carId: number | null; record: unknown }> =>
  (db.prepare('SELECT list, seq, car_id, record FROM facts WHERE session_uid = ? AND weekend_id = ? AND player_car = ? ORDER BY list, seq')
    .all(k.sessionUid, k.weekendId, k.playerCar) as Array<{ list: string; seq: number; car_id: number | null; record: string }>)
    .map((r) => ({ list: r.list, seq: r.seq, carId: r.car_id, record: JSON.parse(r.record) as unknown }));

/** Makes every later change or removal of a fact row fail (C24: append-only, without exception). */
export const forbidFactRewrites = (db: Db): void => {
  db.exec(`CREATE TRIGGER facts_no_delete BEFORE DELETE ON facts BEGIN SELECT RAISE(ABORT, 'a fact row was deleted'); END;
           CREATE TRIGGER facts_no_update BEFORE UPDATE ON facts BEGIN SELECT RAISE(ABORT, 'a fact row was changed'); END;`);
};
