// The read side of storage (Task 27): the sessions of a weekend (the rows), and the one read API, a stored session's
// projection (C28, C34), computed from its stored log by the engine's projection module. A session whose log is not
// complete is never served (C61): `projectionOf` rebuilds it from its recording first, `weekendContext` skips it. The
// weekend context matches a car across sessions by its team and race number (C62).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/log.ts';
import { openDatabase, type SessionRow } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import {
  ASTON_14, FERRARI_16, MERCEDES_44, car, event, factRows, key, keyOf, lap, log, projected, session, span, stint, stored, type Log,
} from './records.ts';

/** A logger whose lines the test reads. */
function captured() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({ level: 'debug', destination: new Writable({ write(c, _e, cb) { lines.push(JSON.parse(String(c)) as Record<string, unknown>); cb(); } }) });
  return { logger, warnings: () => lines.filter((l) => l['level'] === 40) };
}

/** A recording file that exists (its content is never read here: the injected rebuild stands for the real one). */
const recording = (): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'repo-')), 'session.pwrec.gz');
  writeFileSync(path, '');
  return path;
};

function storage() {
  const db = openDatabase(':memory:');
  const writer = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: 'unversioned' });
  /** Stores `row` with `l` as its log, complete unless told otherwise. */
  const put = (row: SessionRow, l: Log = log(), complete = true) => {
    writer.upsertSession(row);
    writer.writeLog(keyOf(row), l);
    if (complete) writer.complete(keyOf(row));
  };
  return { db, writer, put };
}

describe('WeekendRepository.sessionsOf', () => {
  it('returns the weekend\'s rows in start order, each with its cars by car id, its rules version and whether it is complete', () => {
    const { db, put } = storage();
    const q = session('2', { startedAt: '2026-10-27T21:00:00.000Z', playerCar: car(3), cars: [{ carId: car(3), carKey: FERRARI_16 }, { carId: car(0), carKey: MERCEDES_44 }] });
    put(q, log(), false);
    put(session('1'));
    put(session('3', { weekendId: 'W2', startedAt: '2026-10-27T19:00:00.000Z' }));
    expect(new WeekendRepository(db).sessionsOf('W1')).toEqual([
      stored(session('1'), true),
      stored({ ...q, cars: [{ carId: car(0), carKey: MERCEDES_44 }, { carId: car(3), carKey: FERRARI_16 }] }, false),
    ]);
  });
});

describe('WeekendRepository.projectionOf: the one read API (C34)', () => {
  it('is the stored log\'s projection; a key nothing is stored under has none', async () => {
    const { db, put } = storage();
    const l = log({ laps: [lap(1, 1)], stints: [stint(1, 1)], spans: { 'weekend-phase': [span('weekend-phase', 'practice', { detail: { format: 'practice', segment: 1 } })] } });
    put(session('1'), l);
    const repo = new WeekendRepository(db);
    expect(await repo.projectionOf(key('1'))).toEqual(projected(l));
    expect(await repo.projectionOf(key('1', 'W1', car(0)))).toBeUndefined();
    expect(await repo.projectionOf(key('9'))).toBeUndefined();
  });

  it('a session stored without complete is rebuilt from its recording before it is read, once', async () => {
    const { db, writer, put } = storage();
    const row = session('1', { pwrecPath: recording() });
    put(row, log({ laps: [lap(1, 1)] }), false);                        // the bridge was killed before the session ended
    const full = log({ laps: [lap(1, 1), lap(1, 2)], events: [event(3)] });
    const rebuild = vi.fn(async (r: SessionRow) => { writer.replaceLog(r, full, 'unversioned'); });
    const repo = new WeekendRepository(db, { log: captured().logger, rebuild });
    expect(await repo.projectionOf(keyOf(row))).toEqual(projected(full));
    expect(rebuild).toHaveBeenCalledOnce();
    expect(rebuild.mock.calls[0]![0]).toMatchObject({ sessionUid: '1', weekendId: 'W1', playerCar: 1, pwrecPath: row.pwrecPath });
    expect(repo.sessionsOf('W1')).toEqual([stored(row, true)]);
    expect(await repo.projectionOf(keyOf(row))).toEqual(projected(full));
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('an incomplete session whose recording is missing is neither served nor deleted, with a warning (C24, C61)', async () => {
    const { db, put } = storage();
    const row = session('1', { pwrecPath: join(mkdtempSync(join(tmpdir(), 'repo-')), 'gone.pwrec.gz') });
    put(row, log({ laps: [lap(1, 1)] }), false);
    const before = factRows(db, keyOf(row));
    const rebuild = vi.fn(async () => {});
    const { logger, warnings } = captured();
    const repo = new WeekendRepository(db, { log: logger, rebuild });
    expect(await repo.projectionOf(keyOf(row))).toBeUndefined();
    expect(rebuild).not.toHaveBeenCalled();
    expect(warnings()).toEqual([expect.objectContaining({ sessionUid: '1', weekendId: 'W1' })]);
    expect(repo.sessionsOf('W1')).toEqual([stored(row, false)]);
    expect(factRows(db, keyOf(row))).toEqual(before);
  });
});

describe('WeekendRepository.weekendContext (C39, C62)', () => {
  // The player's car is FERRARI_16. Practice: player in slot 1. Qualifying: the same car in slot 3 (the slots differ).
  // A second feed of qualifying whose player is MERCEDES_44. The race (the current session) puts the player in slot 5.
  const practice = session('P', { startedAt: '2026-10-27T20:00:00.000Z' });
  const qualifying = session('Q', { startedAt: '2026-10-27T21:00:00.000Z', playerCar: car(3),
    cars: [{ carId: car(0), carKey: MERCEDES_44 }, { carId: car(3), carKey: FERRARI_16 }, { carId: car(4), carKey: ASTON_14 }] });
  const otherFeed = session('Q', { startedAt: '2026-10-27T21:00:00.000Z', playerCar: car(0), cars: qualifying.cars });
  const race = session('R', { startedAt: '2026-10-27T22:00:00.000Z', playerCar: car(5), cars: [{ carId: car(5), carKey: FERRARI_16 }] });
  const later = session('L', { startedAt: '2026-10-27T23:00:00.000Z' });
  const elsewhere = session('X', { weekendId: 'W2', startedAt: '2026-10-27T19:00:00.000Z' });
  const practiceLog = log({ laps: [lap(1, 1), lap(0, 1)], spans: { 'weekend-phase': [span('weekend-phase', 'practice', { detail: { format: 'practice', segment: 1 } })] } });
  const qualifyingLog = log({ laps: [lap(3, 1)], spans: { 'weekend-phase': [span('weekend-phase', 'qualifying', { detail: { format: 'grandPrix', segment: 1 } })] } });

  function weekend(o: { qualifyingComplete?: boolean } = {}) {
    const { db, put } = storage();
    put(practice, practiceLog);
    // an incomplete session's recording exists, so it can be rebuilt
    put(o.qualifyingComplete === false ? { ...qualifying, pwrecPath: recording() } : qualifying, qualifyingLog, o.qualifyingComplete ?? true);
    put(otherFeed, log({ laps: [lap(0, 1)] }));
    put(race);
    put(later, log({ laps: [lap(1, 1)] }));
    put(elsewhere, log({ laps: [lap(1, 1)] }));
    return db;
  }
  const storedSession = (row: SessionRow, l: Log) => ({
    sessionUid: row.sessionUid, playerCar: row.playerCar, cars: [...row.cars].sort((a, b) => a.carId - b.carId), projection: projected(l),
  });

  it('matches cars by team and race number when the slots differ between sessions: the player\'s earlier sessions, oldest first', () => {
    const repo = new WeekendRepository(weekend());
    expect(repo.weekendContext('W1', FERRARI_16, keyOf(race))).toEqual({
      context: { weekendId: 'W1', player: FERRARI_16, sessions: [storedSession(practice, practiceLog), storedSession(qualifying, qualifyingLog)] },
      incomplete: [],
    });
  });
  it('an earlier session is the player\'s when its own player car had the player\'s key, whatever its slot', () => {
    const repo = new WeekendRepository(weekend());
    expect(repo.weekendContext('W1', MERCEDES_44, keyOf(race)).context.sessions.map((s) => [s.sessionUid, s.playerCar])).toEqual([['Q', 0]]);
    expect(repo.weekendContext('W1', ASTON_14, keyOf(race)).context.sessions).toEqual([]);
  });
  it('holds only sessions that started before the current one, of its own weekend', () => {
    const repo = new WeekendRepository(weekend());
    expect(repo.weekendContext('W1', FERRARI_16, keyOf(qualifying)).context.sessions.map((s) => s.sessionUid)).toEqual(['P']);
    expect(repo.weekendContext('W1', FERRARI_16, keyOf(practice)).context.sessions).toEqual([]);
  });
  it('skips a session whose log is not complete, warns and returns its key for a rebuild', () => {
    const { logger, warnings } = captured();
    const repo = new WeekendRepository(weekend({ qualifyingComplete: false }), { log: logger });
    const { context, incomplete } = repo.weekendContext('W1', FERRARI_16, keyOf(race));
    expect(context.sessions.map((s) => s.sessionUid)).toEqual(['P']);
    expect(incomplete).toEqual([keyOf(qualifying)]);
    expect(warnings()).toEqual([expect.objectContaining({ sessionUid: 'Q', weekendId: 'W1' })]);
  });
  it('the weekend phase of a stored session is its projection\'s weekend-phase span; no text copy exists', () => {
    const repo = new WeekendRepository(weekend());
    const [p] = repo.weekendContext('W1', FERRARI_16, keyOf(race)).context.sessions;
    expect(p!.projection.spans['weekend-phase']).toEqual(practiceLog.spans['weekend-phase']);
    expect(p).not.toHaveProperty('sessionType');
  });

  // The game reuses a session uid across weekends (C60's key holds the weekend): ported from the DriverKey tests at
  // 3364669 (Task 27 fix round 1, C82)
  it('a session\'s cars and projection come from its own weekend when the same uid also exists in another weekend', () => {
    const { db, put } = storage();
    const inW1 = session('1', { playerCar: car(0), cars: [{ carId: car(0), carKey: FERRARI_16 }] });
    const inW2 = session('1', { weekendId: 'W2', playerCar: car(0), cars: [{ carId: car(0), carKey: MERCEDES_44 }, { carId: car(1), carKey: FERRARI_16 }] });
    const w1Log = log({ laps: [lap(0, 1)] });
    put(inW1, w1Log);
    put(inW2, log({ laps: [lap(0, 1, { lapTimeMs: 91_000 }), lap(1, 1)] }));
    const current = session('R', { startedAt: '2026-10-27T22:00:00.000Z', playerCar: car(0), cars: [{ carId: car(0), carKey: FERRARI_16 }] });
    put(current);
    const repo = new WeekendRepository(db);
    expect(repo.weekendContext('W1', FERRARI_16, keyOf(current))).toEqual({
      context: { weekendId: 'W1', player: FERRARI_16, sessions: [storedSession(inW1, w1Log)] },
      incomplete: [],
    });
    // MERCEDES_44 was the player car only of the W2 session
    expect(repo.weekendContext('W1', MERCEDES_44, keyOf(current)).context.sessions).toEqual([]);
  });

  it('`before`\'s start time comes from its own weekend, not from the same uid in another weekend', () => {
    const { db, put } = storage();
    put(session('P', { weekendId: 'W2', startedAt: '2026-10-27T20:00:00.000Z' }));
    const q = session('Q', { weekendId: 'W2', startedAt: '2026-10-27T21:00:00.000Z' });
    put(q);
    put(session('Q', { weekendId: 'W1', startedAt: '2026-10-20T19:00:00.000Z' }));   // the same uid, an earlier weekend
    expect(new WeekendRepository(db).weekendContext('W2', FERRARI_16, keyOf(q)).context.sessions.map((s) => s.sessionUid)).toEqual(['P']);
  });
});

// Task 28 (C61): the repository knows the current rules version (`rulesVersion`). A session stored under another one is
// stale and treated like an incomplete one wherever completeness is checked: never served, rebuilt first, skipped by the
// weekend context. An unchanged, complete session is served as it is.
describe('WeekendRepository: a stale rules version (C61)', () => {
  const OLD = 'old-rules';
  const NEW = 'new-rules';

  /** Storage whose rows are written under `OLD`: an earlier bridge stored them. */
  function staleStorage() {
    const db = openDatabase(':memory:');
    const old = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: OLD });
    const current = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: NEW });
    /** Stores `row` complete with `l` as its log, under `OLD` unless `version` says `NEW`. */
    const put = (row: SessionRow, l: Log = log(), version: typeof OLD | typeof NEW = OLD) => {
      const writer = version === OLD ? old : current;
      writer.upsertSession(row);
      writer.writeLog(keyOf(row), l);
      writer.complete(keyOf(row));
    };
    return { db, current, put };
  }

  it('a complete session of another rules version is rebuilt from its recording before it is read, once', async () => {
    const { db, current, put } = staleStorage();
    const row = session('1', { pwrecPath: recording() });
    put(row, log({ laps: [lap(1, 1)] }));
    const rebuiltLog = log({ laps: [lap(1, 1)], events: [event(3)] });
    const rebuild = vi.fn(async (r: SessionRow) => { current.replaceLog(r, rebuiltLog, NEW); });
    const repo = new WeekendRepository(db, { log: captured().logger, rebuild, rulesVersion: NEW });
    expect(await repo.projectionOf(keyOf(row))).toEqual(projected(rebuiltLog));
    expect(rebuild).toHaveBeenCalledOnce();
    expect(rebuild.mock.calls[0]![0]).toMatchObject({ sessionUid: '1', weekendId: 'W1', playerCar: 1, rulesVersion: OLD, complete: true });
    expect(repo.sessionsOf('W1')).toEqual([stored(row, true, NEW)]);
    expect(await repo.projectionOf(keyOf(row))).toEqual(projected(rebuiltLog));
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('an unchanged rules version rebuilds nothing: a complete session of the current version is served as stored', async () => {
    const { db, put } = staleStorage();
    const row = session('1', { pwrecPath: recording() });
    const l = log({ laps: [lap(1, 1)] });
    put(row, l, NEW);
    const before = factRows(db, keyOf(row));
    const rebuild = vi.fn(async () => {});
    const repo = new WeekendRepository(db, { rebuild, rulesVersion: NEW });
    expect(await repo.projectionOf(keyOf(row))).toEqual(projected(l));
    expect(rebuild).not.toHaveBeenCalled();
    expect(factRows(db, keyOf(row))).toEqual(before);
  });

  it('a stale session whose recording is missing is kept and not served, with a warning (C24)', async () => {
    const { db, put } = staleStorage();
    const row = session('1', { pwrecPath: join(mkdtempSync(join(tmpdir(), 'repo-')), 'gone.pwrec.gz') });
    put(row, log({ laps: [lap(1, 1)] }));
    const before = factRows(db, keyOf(row));
    const rebuild = vi.fn(async () => {});
    const { logger, warnings } = captured();
    const repo = new WeekendRepository(db, { log: logger, rebuild, rulesVersion: NEW });
    expect(await repo.projectionOf(keyOf(row))).toBeUndefined();
    expect(rebuild).not.toHaveBeenCalled();
    expect(warnings()).toEqual([expect.objectContaining({ sessionUid: '1', weekendId: 'W1' })]);
    expect(repo.sessionsOf('W1')).toEqual([stored(row, true, OLD)]);
    expect(factRows(db, keyOf(row))).toEqual(before);
  });

  it('a rebuild that no longer produces the session keeps the stored row and log, never serves it, and warns once (C24)', async () => {
    const { db, put } = staleStorage();
    const row = session('1', { pwrecPath: recording() });
    put(row, log({ laps: [lap(1, 1)] }));
    const before = factRows(db, keyOf(row));
    // the recording now yields no such session: the rebuild writes nothing under its key
    const rebuild = vi.fn(async () => {});
    const { logger, warnings } = captured();
    const repo = new WeekendRepository(db, { log: logger, rebuild, rulesVersion: NEW });
    expect(await repo.projectionOf(keyOf(row))).toBeUndefined();
    expect(await repo.projectionOf(keyOf(row))).toBeUndefined();
    expect(warnings()).toEqual([expect.objectContaining({ sessionUid: '1', weekendId: 'W1' })]);
    expect(repo.sessionsOf('W1')).toEqual([stored(row, true, OLD)]);
    expect(factRows(db, keyOf(row))).toEqual(before);
  });

  it('weekendContext skips a session of another rules version, warns and returns its key for a rebuild', () => {
    const { db, put } = staleStorage();
    const practice = session('P', { startedAt: '2026-10-27T20:00:00.000Z' });
    const qualifying = session('Q', { startedAt: '2026-10-27T21:00:00.000Z' });
    const race = session('R', { startedAt: '2026-10-27T22:00:00.000Z' });
    put(practice, log({ laps: [lap(1, 1)] }), NEW);
    put(qualifying, log({ laps: [lap(1, 1)] }));
    put(race, log(), NEW);
    const { logger, warnings } = captured();
    const repo = new WeekendRepository(db, { log: logger, rulesVersion: NEW });
    const { context, incomplete } = repo.weekendContext('W1', FERRARI_16, keyOf(race));
    expect(context.sessions.map((s) => s.sessionUid)).toEqual(['P']);
    expect(incomplete).toEqual([keyOf(qualifying)]);
    expect(warnings()).toEqual([expect.objectContaining({ sessionUid: 'Q', weekendId: 'W1' })]);
  });
});

// SP4.1a Task 5 (C34, C61, C62a): the calibration store reads the stored sessions of one track. Only complete sessions
// are offered; one of another rules version is offered as stale, without its projection (it is never served, C61).
describe('WeekendRepository.sessionsOnTrack', () => {
  it('returns the complete sessions on the track in start order with their weekend phase; another rules version is stale and has no projection', () => {
    const db = openDatabase(':memory:');
    const writer = (rulesVersion: string) => new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion });
    const current = writer('current'), old = writer('old');
    const put = (w: StorageWriter, row: SessionRow, l: Log, complete = true) => {
      w.upsertSession(row);
      w.writeLog(keyOf(row), l);
      if (complete) w.complete(keyOf(row));
    };
    const race = { 'weekend-phase': [span('weekend-phase', 'race', { detail: { format: 'grandPrix' } })] };
    const later = session('2', { startedAt: '2026-10-27T21:00:00.000Z' });
    const earlier = session('1', { startedAt: '2026-10-27T20:00:00.000Z' });
    put(current, later, log({ stints: [stint(1, 1)], laps: [lap(1, 1)], spans: race }));
    put(old, earlier, log({ stints: [stint(1, 1)], spans: race }));
    put(current, session('3', { startedAt: '2026-10-27T22:00:00.000Z' }), log({ spans: race }), false);
    put(current, session('4', { weekendId: 'W2', trackId: 27 }), log({ spans: race }));

    const sessions = new WeekendRepository(db, { rulesVersion: 'current' }).sessionsOnTrack(26);
    expect(sessions.map((s) => [s.sessionUid, s.stale])).toEqual([['1', true], ['2', false]]);
    const fresh = sessions[1];
    expect(fresh?.stale === false ? fresh.phase : undefined).toEqual({ kind: 'race', format: 'grandPrix' });
    expect(sessions[0]?.projection).toBeUndefined();
    expect(sessions[1]?.projection?.stints).toEqual([stint(1, 1)]);
    expect(sessions[1]?.projection?.laps).toEqual([lap(1, 1)]);
    expect(sessions[1]).toMatchObject({ weekendId: 'W1', playerCar: car(1), trackId: 26, startedAt: '2026-10-27T21:00:00.000Z', cars: later.cars });
  });

  it('a stale session\'s phase is not read from its log', () => {
    const db = openDatabase(':memory:');
    const old = new StorageWriter(db, { onError: (e) => { throw e; }, rulesVersion: 'old' });
    const row = session('1');
    old.upsertSession(row);
    old.writeLog(keyOf(row), log({ stints: [stint(1, 1)], spans: { 'weekend-phase': [span('weekend-phase', 'race', { detail: { format: 'grandPrix' } })] } }));
    old.complete(keyOf(row));

    const [stale, ...rest] = new WeekendRepository(db, { rulesVersion: 'current' }).sessionsOnTrack(26);
    expect(rest).toEqual([]);
    expect(stale).toMatchObject({ sessionUid: '1', stale: true, projection: undefined });
    // The stale log is never served (C61): not as a projection, and not as the weekend phase read from it.
    expect(stale !== undefined && 'phase' in stale).toBe(false);
  });
});

// SP4.1a f34 (F3, C43, C60): the session row carries the teammate the engine placed (`teammateCar`, `null` without one),
// stored with the row like its player car, so the calibration store takes our cars from the row, never by its own rule.
describe('the stored teammate', () => {
  it('a row\'s teammate is stored with it and read back by sessionsOf and sessionsOnTrack; none is null', () => {
    const { db, put } = storage();
    const cars = [{ carId: car(0), carKey: MERCEDES_44 }, { carId: car(1), carKey: FERRARI_16 }, { carId: car(2), carKey: FERRARI_16 }];
    put(session('1', { cars, teammateCar: car(2) }));
    put(session('2', { startedAt: '2026-10-27T21:00:00.000Z', cars, teammateCar: null }));
    const repo = new WeekendRepository(db);
    expect(repo.sessionsOf('W1').map((s) => [s.sessionUid, s.teammateCar])).toEqual([['1', 2], ['2', null]]);
    expect(repo.sessionsOnTrack(26).map((s) => [s.sessionUid, s.teammateCar])).toEqual([['1', 2], ['2', null]]);
  });

  it('a newer row of the session replaces its teammate (the newest wins); a rebuild writes the rebuilt one', () => {
    const { db, writer } = storage();
    const row = session('1', { teammateCar: null });
    writer.upsertSession(row);
    writer.upsertSession({ ...row, teammateCar: car(0) });
    const repo = new WeekendRepository(db);
    expect(repo.sessionsOf('W1')[0]?.teammateCar).toBe(0);
    writer.replaceLog({ ...row, teammateCar: null }, log(), 'unversioned');
    expect(repo.sessionsOf('W1')[0]?.teammateCar).toBeNull();
  });
});
