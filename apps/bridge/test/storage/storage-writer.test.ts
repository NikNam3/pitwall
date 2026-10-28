import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { all, event, history, lap, sc, session, since, stint } from './records.ts';

function setup() {
  const db = openDatabase(':memory:');
  const onError = vi.fn();
  const writer = new StorageWriter(db, { onError });
  writer.upsertSession(session('1'));
  return { db, onError, writer, repo: new WeekendRepository(db) };
}

describe('StorageWriter', () => {
  it('writes only confirmed laps; provisional ones are ignored until confirmed', () => {
    const { writer, repo, onError } = setup();
    const h1 = history({ laps: [lap(0, 1, { status: 'provisional' }), lap(0, 1), lap(0, 2, { status: 'provisional' })] });
    writer.writeConfirmed('1', h1, all(h1));
    expect(repo.lapsOf('1')).toEqual([lap(0, 1)]);
    const h2 = history({ laps: [...h1.laps, lap(0, 2)] });
    writer.writeConfirmed('1', h2, since(h1, h2));
    expect(repo.lapsOf('1')).toEqual([lap(0, 1), lap(0, 2)]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('upserts by (session, car, lap): the last confirmed value wins', () => {
    const { writer, repo } = setup();
    const h = history({ laps: [lap(0, 1, { lapTimeMs: 90_100 }), lap(0, 1, { lapTimeMs: 90_000 })] });
    writer.writeConfirmed('1', h, all(h));
    expect(repo.lapsOf('1').map((l) => l.lapTimeMs)).toEqual([90_000]);
  });
  it('is idempotent', () => {
    const { db, writer, repo } = setup();
    const h = history({ laps: [lap(0, 1)], stints: [stint(0, 1)], flagPhases: [sc(1000)], events: [event(5, 0), event(6)] });
    writer.writeConfirmed('1', h, all(h));
    writer.writeConfirmed('1', h, all(h));
    expect(db.prepare('SELECT count(*) FROM events').pluck().get()).toBe(2);
    expect(repo.stintsOf('1')).toEqual([stint(0, 1)]);
    expect(repo.flagPhasesOf('1')).toEqual([sc(1000)]);
    expect(repo.eventsOf('1')).toEqual([event(5, 0), event(6)]);
  });
  it('a truncated delta (flashback) rewrites the session history', () => {
    const { writer, repo } = setup();
    const h1 = history({ laps: [lap(0, 1), lap(0, 2)], events: [event(1), event(2), event(3)] });
    writer.writeConfirmed('1', h1, all(h1));
    const h2 = history({ laps: [lap(0, 1)], events: [event(1), event(9)] });
    writer.writeConfirmed('1', h2, since(h1, h2, true));
    expect(repo.lapsOf('1')).toEqual([lap(0, 1)]);
    expect(repo.eventsOf('1')).toEqual([event(1), event(9)]);
  });
  it('one transaction per call: a failure rolls back the batch, calls onError and does not throw', () => {
    const { db, writer, onError } = setup();
    db.exec("CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const h = history({ laps: [lap(0, 1)], events: [event(1)] });
    expect(() => writer.writeConfirmed('1', h, all(h))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).toContain('boom');
    expect(db.prepare('SELECT count(*) FROM laps').pluck().get()).toBe(0);
  });
  it('a closed database is reported through onError', () => {
    const { db, writer, onError } = setup();
    db.close();
    expect(() => writer.upsertSession(session('2'))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});
