// The storage writer (Task 27): each session's log, as it is, in generic tables (C24, C60), per feed (C1a). A live
// session appends what each list gained (C24: no row is ever changed or removed); a rebuild replaces a session's log as
// a whole in one transaction (C61). Every read goes through the one read API, the projection (C28, C34).
import { describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import {
  ASTON_14, FERRARI_16, MERCEDES_44, car, event, factRows, forbidFactRewrites, key, keyOf, lap, log, pitStop, projected, session, slot, span, stint, stored, voidFact,
} from './records.ts';

const K = key('1');

function setup() {
  const db = openDatabase(':memory:');
  const onError = vi.fn();
  const writer = new StorageWriter(db, { onError, rulesVersion: 'unversioned' });
  writer.upsertSession(session('1'));
  return { db, onError, writer, repo: new WeekendRepository(db) };
}

const tables = (db: Db) => db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name").pluck().all();

describe('StorageWriter: the session row and its cars', () => {
  it('upsertSession stores the row with the storage\'s rules version, not complete, and every car with its key', () => {
    const { repo, onError } = setup();
    expect(repo.sessionsOf('W1')).toEqual([stored(session('1'), false)]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('upsertSession again (the identity changed) replaces the cars: the newest wins', () => {
    const { writer, repo } = setup();
    const cars = [slot(0, ASTON_14, 'Driver Zero'), slot(1, FERRARI_16, 'Driver One'), slot(2, MERCEDES_44, 'Driver Two')];
    writer.upsertSession(session('1', { cars }));
    expect(repo.sessionsOf('W1')).toEqual([stored(session('1', { cars }), false)]);
  });
  // SP4.1a fx2 (C3, C60, C62): the calibration panel shows a source's driver (CAR); storage keeps each slot's driver name
  // as the session's Participants last named it, beside its team and race number. A name the game does not send (or
  // hides) is stored as NULL and read back as unknown, never as an empty string.
  it('a stored session keeps each slot\'s driver name; a slot without one reads unknown', async () => {
    const { db, writer, repo } = setup();
    const cars = [slot(0, MERCEDES_44, 'Driver Zero'), slot(1, FERRARI_16), slot(2, ASTON_14, 'Driver Two')];
    const row = session('1', { cars });
    writer.upsertSession(row);
    expect(repo.sessionsOf('W1')[0]?.cars).toEqual([
      { carId: car(0), carKey: MERCEDES_44, driver: { known: true, value: 'Driver Zero', at: 0 } },
      { carId: car(1), carKey: FERRARI_16, driver: { known: false, reason: 'notReceived' } },
      { carId: car(2), carKey: ASTON_14, driver: { known: true, value: 'Driver Two', at: 0 } },
    ]);
    // NULL in the row, not an empty string.
    expect(db.prepare("SELECT car_id, name FROM cars WHERE session_uid = '1' ORDER BY car_id").all())
      .toEqual([{ car_id: 0, name: 'Driver Zero' }, { car_id: 1, name: null }, { car_id: 2, name: 'Driver Two' }]);
    // A rebuild writes the rebuilt names: the newest wins.
    writer.replaceLog(session('1', { cars: [slot(0, MERCEDES_44), slot(1, FERRARI_16, 'Driver One')] }), log(), 'unversioned');
    expect(repo.sessionsOf('W1')[0]?.cars).toEqual([
      { carId: car(0), carKey: MERCEDES_44, driver: { known: false, reason: 'notReceived' } },
      { carId: car(1), carKey: FERRARI_16, driver: { known: true, value: 'Driver One', at: 0 } },
    ]);
    expect(await repo.projectionOf(keyOf(row))).toEqual(projected(log()));
  });
  it('a closed database is reported through onError', () => {
    const { db, writer, onError } = setup();
    db.close();
    expect(() => writer.upsertSession(session('2'))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('StorageWriter: a live session appends its log', () => {
  it('stores every list of the log by its name and log position, with the car of a car\'s fact', () => {
    const { db, writer, onError } = setup();
    const l = log({
      laps: [lap(0, 1, { status: 'provisional' }), lap(0, 1)], stints: [stint(1, 1)], pitStops: [pitStop(1, 3)], events: [event(5)],
      clock: [{ kind: 'simulatedEnd', at: 9_000, frame: 90 }],
      spans: { 'car-status': [span('car-status', 'competing', { carId: car(1) })], 'weekend-phase': [span('weekend-phase', 'race', { detail: { format: 'grandPrix' } })] },
    });
    writer.writeLog(K, l);
    // the log as it is (C24): provisional laps too, superseded only by a later fact (C25)
    expect(factRows(db, K)).toEqual([
      { list: 'clock', seq: 0, carId: null, record: l.clock[0] },
      { list: 'events', seq: 0, carId: null, record: l.events[0] },
      { list: 'laps', seq: 0, carId: 0, record: l.laps[0] },
      { list: 'laps', seq: 1, carId: 0, record: l.laps[1] },
      { list: 'pitStops', seq: 0, carId: 1, record: l.pitStops[0] },
      { list: 'spans:car-status', seq: 0, carId: 1, record: l.spans['car-status']![0] },
      { list: 'spans:weekend-phase', seq: 0, carId: null, record: l.spans['weekend-phase']![0] },
      { list: 'stints', seq: 0, carId: 1, record: l.stints[0] },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('each write appends only what each list gained since the writer\'s last write; a write with nothing new adds no row', () => {
    const { db, writer } = setup();
    forbidFactRewrites(db);
    const l = log({ laps: [lap(0, 1)], events: [event(1)] });
    writer.writeLog(K, l);
    l.laps.push(lap(0, 2));
    l.events.push(event(2), event(3));
    writer.writeLog(K, l);
    writer.writeLog(K, l);
    expect(factRows(db, K).map((r) => [r.list, r.seq])).toEqual([['events', 0], ['events', 1], ['events', 2], ['laps', 0], ['laps', 1]]);
    expect(factRows(db, K).map((r) => r.record)).toEqual([event(1), event(2), event(3), lap(0, 1), lap(0, 2)]);
  });
  it('a flashback writes its void and deletes no row (C24, C27)', async () => {
    const { db, writer, repo, onError } = setup();
    forbidFactRewrites(db);
    const l = log({ laps: [lap(0, 1), lap(0, 2)], events: [event(1), event(2), event(3)] });
    writer.writeLog(K, l);
    const before = factRows(db, K);
    // the game rewinds: lap 2 and the third event never happened; the replayed frames record a lap 2 again, then a new event
    l.voids.push(voidFact({ laps: [1, 2], events: [2, 3] }));
    l.laps.push(lap(0, 2, { lapTimeMs: 91_000 }));
    l.events.push(event(9));
    writer.writeLog(K, l);
    expect(onError).not.toHaveBeenCalled();
    const after = factRows(db, K);
    for (const row of before) expect(after).toContainEqual(row);
    expect(after.filter((r) => r.list === 'voids')).toEqual([{ list: 'voids', seq: 0, carId: null, record: l.voids[0] }]);
    expect(after).toHaveLength(before.length + 3);
    writer.complete(K);
    // read back through the projection: the voided positions are skipped (C28)
    expect(await repo.projectionOf(K)).toEqual(projected(log({ laps: [lap(0, 1), lap(0, 2, { lapTimeMs: 91_000 })], events: [event(1), event(2), event(9)] })));
  });
  it('complete marks the session complete; then its projection is served', async () => {
    const { writer, repo } = setup();
    const l = log({ laps: [lap(0, 1)], spans: { 'car-status': [span('car-status', 'competing', { carId: car(0) })] } });
    writer.writeLog(K, l);
    writer.complete(K);
    expect(repo.sessionsOf('W1')).toEqual([stored(session('1'), true)]);
    expect(await repo.projectionOf(K)).toEqual(projected(l));
  });
  it('formation facts are stored and not returned (C29)', async () => {
    const { db, writer, repo } = setup();
    const formation = span('session-phase-race', 'formation', { id: 0, startFrame: 1, endFrame: 50 });
    const racing = span('session-phase-race', 'racing', { id: 1, startFrame: 50, endFrame: 900 });
    // lap 0 is recorded on the formation lap (frame 20), lap 1 in the race (frame 120)
    const l = log({ laps: [lap(0, 0, { frame: 20 }), lap(0, 1, { frame: 120 })], events: [event(3, 0, 30), event(7, 0, 200)], spans: { 'session-phase-race': [formation, racing] } });
    writer.writeLog(K, l);
    writer.complete(K);
    expect(factRows(db, K).filter((r) => r.list === 'laps').map((r) => r.record)).toEqual(l.laps);
    expect(await repo.projectionOf(K)).toEqual(projected(log({ laps: [lap(0, 1, { frame: 120 })], events: [event(7, 0, 200)], spans: { 'session-phase-race': [formation, racing] } })));
  });
  it('a new sub-machine\'s spans need no schema change: they are rows of its own span list', async () => {
    const { db, writer, repo } = setup();
    const schema = tables(db);
    const l = log({ spans: { 'test-new-machine': [span('test-new-machine', 'one', { detail: { n: 1 } }), span('test-new-machine', 'two', { id: 1, startFrame: 10, endFrame: 20 })] } });
    writer.writeLog(K, l);
    writer.complete(K);
    expect(tables(db)).toEqual(schema);
    expect(factRows(db, K).map((r) => [r.list, r.seq])).toEqual([['spans:test-new-machine', 0], ['spans:test-new-machine', 1]]);
    expect(await repo.projectionOf(K)).toEqual(projected(l));
  });
  it('one transaction per call: a failure rolls back the batch, calls onError and does not throw', () => {
    const { db, writer, onError } = setup();
    db.exec("CREATE TRIGGER fail_events BEFORE INSERT ON facts WHEN NEW.list = 'events' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const l = log({ laps: [lap(0, 1)], events: [event(1)] });
    expect(() => writer.writeLog(K, l)).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).toContain('boom');
    expect(factRows(db, K)).toEqual([]);
  });
});

describe('StorageWriter: sessions side by side', () => {
  it('two feeds of one session are stored side by side, each with its row, cars and log (C1a)', async () => {
    const { writer, repo, onError } = setup();
    const second = session('1', { playerCar: car(0), cars: [slot(0, MERCEDES_44, 'Driver Zero'), slot(1, FERRARI_16)] });
    writer.upsertSession(second);
    const mine = log({ laps: [lap(1, 1)] });
    const theirs = log({ laps: [lap(0, 1), lap(0, 2)] });
    writer.writeLog(K, mine);
    writer.writeLog(keyOf(second), theirs);
    writer.complete(K);
    writer.complete(keyOf(second));
    expect(repo.sessionsOf('W1')).toEqual(expect.arrayContaining([stored(session('1'), true), stored(second, true)]));
    expect(repo.sessionsOf('W1')).toHaveLength(2);
    expect(await repo.projectionOf(K)).toEqual(projected(mine));
    expect(await repo.projectionOf(keyOf(second))).toEqual(projected(theirs));
    expect(onError).not.toHaveBeenCalled();
  });
  it('two sessions with the same uid in different weekends are stored side by side', async () => {
    const { writer, repo } = setup();
    const w2 = session('1', { weekendId: 'W2', startedAt: '2026-11-03T20:00:00.000Z' });
    writer.upsertSession(w2);
    const l1 = log({ events: [event(5, 0)] });
    const l2 = log({ events: [event(8), event(9, 0)] });
    writer.writeLog(K, l1);
    writer.writeLog(keyOf(w2), l2);
    writer.complete(K);
    writer.complete(keyOf(w2));
    expect(repo.sessionsOf('W1')).toEqual([stored(session('1'), true)]);
    expect(repo.sessionsOf('W2')).toEqual([stored(w2, true)]);
    expect(await repo.projectionOf(K)).toEqual(projected(l1));
    expect(await repo.projectionOf(keyOf(w2))).toEqual(projected(l2));
  });
});

describe('StorageWriter: a rebuild replaces a session\'s log as a whole (C24, C61)', () => {
  it('replaceLog writes the log, the cars and the row, complete, with the given rules version; the session\'s old rows are gone', async () => {
    const { db, writer, repo, onError } = setup();
    writer.writeLog(K, log({ laps: [lap(0, 1)], events: [event(1), event(2)] }));
    const cars = [slot(1, FERRARI_16, 'Driver One'), slot(3, ASTON_14)];
    const rebuilt = log({ laps: [lap(0, 1, { lapTimeMs: 89_000 })], stints: [stint(0, 1)] });
    writer.replaceLog(session('1', { cars, trackId: 27 }), rebuilt, 'rules-2');
    expect(onError).not.toHaveBeenCalled();
    expect(repo.sessionsOf('W1')).toEqual([stored(session('1', { cars, trackId: 27 }), true, 'rules-2')]);
    expect(factRows(db, K).map((r) => [r.list, r.seq])).toEqual([['laps', 0], ['stints', 0]]);
    expect(await repo.projectionOf(K)).toEqual(projected(rebuilt));
  });
  it('replaceLog of one session keeps the others: the same uid in another weekend, another feed', async () => {
    const { writer, repo } = setup();
    const w2 = session('1', { weekendId: 'W2' });
    const feed2 = session('1', { playerCar: car(0) });
    const other = log({ events: [event(4)] });
    for (const row of [w2, feed2]) {
      writer.upsertSession(row);
      writer.writeLog(keyOf(row), other);
      writer.complete(keyOf(row));
    }
    writer.replaceLog(session('1'), log({ laps: [lap(1, 1)] }), 'unversioned');
    expect(await repo.projectionOf(keyOf(w2))).toEqual(projected(other));
    expect(await repo.projectionOf(keyOf(feed2))).toEqual(projected(other));
  });
  it('a replaceLog that fails leaves the old log and row as they were', async () => {
    const { db, writer, repo, onError } = setup();
    const old = log({ laps: [lap(0, 1)], events: [event(1)] });
    writer.writeLog(K, old);
    writer.complete(K);
    db.exec("CREATE TRIGGER fail_stints BEFORE INSERT ON facts WHEN NEW.list = 'stints' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    writer.replaceLog(session('1', { trackId: 27 }), log({ laps: [lap(0, 1, { lapTimeMs: 89_000 })], stints: [stint(0, 1)] }), 'rules-2');
    expect(onError).toHaveBeenCalledOnce();
    expect(repo.sessionsOf('W1')).toEqual([stored(session('1'), true)]);
    expect(await repo.projectionOf(K)).toEqual(projected(old));
  });
});
