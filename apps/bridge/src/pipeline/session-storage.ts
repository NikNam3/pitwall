// The derived storage layer for one session (spec 9.2, 9.3): its row, its confirmed history, its weekend context.
import { carId, type DriverKey, type SessionUid } from '@pitwall/domain';
import { driverKeyOf, type DeepReadonly, type History, type HistoryDelta, type WeekendContext } from '@pitwall/engine';
import type { ParticipantsPacket, SessionPacket } from '@pitwall/protocol';
import type { Logger } from '../log.ts';
import type { Db, SessionRow } from '../storage/db.ts';
import { StorageWriter } from '../storage/storage-writer.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';

/** The game settings stored with a session, as the Session packet sends them. */
const SETTINGS = [
  'safetyCar', 'redFlags', 'carDamage', 'carDamageRate', 'tyreTemperature', 'lowFuelMode', 'recoveryMode', 'flashbackLimit',
  'surfaceType', 'collisions', 'pitLaneTyreSim', 'parcFermeRules', 'equalCarPerformance', 'formationLap', 'aiDifficulty',
  'gameMode', 'ruleSet',
] as const satisfies ReadonlyArray<keyof SessionPacket>;

const driversOf = (participants: ParticipantsPacket | undefined): SessionRow['drivers'] =>
  participants === undefined
    ? []
    : Array.from({ length: participants.numActiveCars }, (_, i) => ({ carId: carId(i), driverKey: driverKeyOf(participants, i) }));

export type SessionRowInput = {
  sessionUid: SessionUid;
  session: SessionPacket;
  startedAt: string;
  pwrecPath: string | null;
  participants?: ParticipantsPacket;
};

export const sessionRowOf = (s: SessionRowInput): SessionRow => ({
  sessionUid: s.sessionUid,
  weekendId: String(s.session.weekendLinkIdentifier),
  seasonId: String(s.session.seasonLinkIdentifier),
  sessionType: s.session.sessionType,
  trackId: s.session.trackId,
  startedAt: s.startedAt,
  pwrecPath: s.pwrecPath,
  settings: Object.fromEntries(SETTINGS.map((name) => [name, s.session[name]])),
  drivers: driversOf(s.participants),
});

/**
 * One session's access to the database. Never throws: the first failure goes to `onError` and turns storage off
 * for the rest of the session, so the live topics carry on without it.
 */
export class SessionStorage {
  readonly #log: Logger;
  readonly #onError: (error: unknown) => void;
  #access: { writer: StorageWriter; repo: WeekendRepository } | undefined;

  constructor(db: Db, opts: { log: Logger; onError: (error: unknown) => void }) {
    this.#log = opts.log;
    this.#onError = opts.onError;
    try {
      this.#access = { writer: new StorageWriter(db, { onError: (error) => this.#fail(error) }), repo: new WeekendRepository(db) };
    } catch (error) {
      this.#fail(error);
    }
  }

  upsertSession(row: SessionRow): void {
    this.#access?.writer.upsertSession(row);
  }

  writeConfirmed(sessionUid: SessionUid, history: DeepReadonly<History>, delta: HistoryDelta): void {
    this.#access?.writer.writeConfirmed(sessionUid, history, delta);
  }

  /** The player's earlier sessions of the weekend with every driver's records; `undefined` when storage is off or this session was never stored. */
  weekendContext(weekendId: string, driverKey: DriverKey, sessionUid: SessionUid): WeekendContext | undefined {
    const repo = this.#access?.repo;
    if (repo === undefined) return undefined;
    try {
      // Asked with an unknown `before`, the repository finds no earlier sessions: say so instead of losing them quietly.
      if (!repo.sessionsOf(weekendId).some((row) => row.sessionUid === sessionUid)) {
        this.#log.warn({ sessionUid, weekendId }, 'session not stored, starting without its weekend context');
        return undefined;
      }
      return repo.weekendContext(weekendId, driverKey, { before: sessionUid });
    } catch (error) {
      this.#fail(error);
      return undefined;
    }
  }

  /** Storage is off from the first failure on, so `onError` is called at most once. */
  #fail(error: unknown): void {
    this.#access = undefined;
    this.#onError(error);
  }
}
