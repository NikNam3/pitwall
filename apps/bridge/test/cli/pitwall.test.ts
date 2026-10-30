import { createSocket } from 'node:dgram';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { dataDir } from '../../src/storage/data-dir.ts';
import { SCHEMA_VERSION } from '../../src/storage/db.ts';
import { runCli, SEGMENT, startCli } from '../helpers/cli.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-cli-'));
const dump = (dir: string) => { const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath, { readonly: true });
  const r = Object.fromEntries(['sessions', 'laps', 'events'].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])); db.close(); return r; };

describe('pitwall CLI', { timeout: 30_000 }, () => {
  it('unknown command → usage, exit 1', async () => {
    const r = await runCli(['fly']);
    expect(r.code).toBe(1); expect(r.stderr).toContain('usage: pitwall <live|replay|tap|reprocess|import>');
  });
  it('replay serves the segment; tap prints hello and the session.info snapshot as JSON lines', async () => {
    // At the recorded pace, so the session is still running when the tap subscribes: calculators run on demand.
    const replay = startCli(['replay', SEGMENT, '--realtime'], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: tmp() });
    const [, port] = (await replay.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/))!;
    await new Promise((r) => setTimeout(r, 500));
    const tap = startCli(['tap', 'session.info', '--url', `ws://127.0.0.1:${port}`], {});
    await tap.waitFor(/"sessionUid":"13536157633115227668"/);
    const lines = tap.stdout().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'hello', contractVersion: 8 });
    expect(lines.some((m) => m.type === 'snapshot' || m.type === 'update')).toBe(true);
    expect(await tap.stop()).toBe(0); expect(await replay.stop()).toBe(0);
  });
  it('tap rejects an unknown topic and a per-car topic without --carId', async () => {
    expect(await runCli(['tap', 'weather'])).toMatchObject({ code: 1, stderr: expect.stringContaining('pitwall: unknown topic "weather"') });
    expect(await runCli(['tap', 'car.detail'])).toMatchObject({ code: 1, stderr: expect.stringContaining('pitwall: topic car.detail needs --carId') });
  });
  it('live: busy WebSocket port → clear message, exit 1', async () => {
    const srv = createServer().listen(0); await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as { port: number }).port;
    const r = await runCli(['live'], { PITWALL_WS_PORT: String(port), PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: tmp() });
    srv.close();
    expect(r.code).toBe(1); expect(r.stderr).toContain(`pitwall: WebSocket port ${port} is already in use`); expect(r.stdout).not.toContain('listening');
  });
  it('live: busy UDP port → clear message, exit 1', async () => {
    const sock = createSocket('udp4'); await new Promise<void>((r) => sock.bind(0, () => r()));
    const port = sock.address().port;
    const r = await runCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: String(port), PITWALL_DATA_DIR: tmp() });
    sock.close();
    expect(r.code).toBe(1); expect(r.stderr).toContain(`pitwall: UDP port ${port} is already in use`);
  });
  it('live: data dir not writable → exit 1 with a pitwall: message', async () => {
    const file = join(tmp(), 'file'); writeFileSync(file, '');
    const r = await runCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: join(file, 'data') });
    expect(r.code).toBe(1); expect(r.stderr).toMatch(/^pitwall: /m);
  });
  it('live: a database of another schema version is deleted and rebuilt from the recordings, then served', async () => {
    const dir = tmp(); const dirs = dataDir({ PITWALL_DATA_DIR: dir });
    copyFileSync(SEGMENT, join(dirs.recordings, basename(SEGMENT)));
    const old = new Database(dirs.dbPath); old.exec('CREATE TABLE foreign_table (x INTEGER)'); old.pragma('user_version = 999'); old.close();
    const live = startCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: dir });
    await live.waitFor(/listening ws:\/\/127\.0\.0\.1:\d+/);
    expect(live.stderr()).toContain('database schema 999 is outdated; rebuilding it from the recordings');
    expect(await live.stop()).toBe(0);
    const db = new Database(dirs.dbPath, { readonly: true });
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      expect(db.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'foreign_table'").pluck().get()).toBe(0);
      expect(db.prepare('SELECT count(*) FROM sessions').pluck().get()).toBe(1);
      expect(db.prepare('SELECT count(*) FROM laps').pluck().get()).toBeGreaterThan(0);
    } finally { db.close(); }
  });
  it('live: a new database is created empty, not filled from the recordings', async () => {
    const dir = tmp(); const dirs = dataDir({ PITWALL_DATA_DIR: dir });
    copyFileSync(SEGMENT, join(dirs.recordings, basename(SEGMENT)));
    const live = startCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: dir });
    await live.waitFor(/listening ws:\/\/127\.0\.0\.1:\d+/);
    expect(await live.stop()).toBe(0);
    expect(live.stderr()).not.toContain('is outdated');
    expect(dump(dir)['sessions']).toHaveLength(0);
  });
  it('reprocess rebuilds the database identically', async () => {
    const dir = tmp(); const rec = dataDir({ PITWALL_DATA_DIR: dir }).recordings; mkdirSync(rec, { recursive: true }); copyFileSync(SEGMENT, join(rec, basename(SEGMENT)));
    const first = await runCli(['reprocess'], { PITWALL_DATA_DIR: dir });
    expect(first).toMatchObject({ code: 0, stdout: expect.stringContaining('reprocessed 1 recordings') });
    const a = dump(dir);
    expect(a['sessions']).toHaveLength(1);
    expect((await runCli(['reprocess'], { PITWALL_DATA_DIR: dir })).code).toBe(0);
    expect(dump(dir)).toEqual(a);
  });
  it('import copies the file into the data dir and processes it; a second import is refused', async () => {
    const dir = tmp();
    const r = await runCli(['import', SEGMENT], { PITWALL_DATA_DIR: dir });
    expect(r).toMatchObject({ code: 0, stdout: expect.stringContaining(`imported ${basename(SEGMENT)}`) });
    expect(existsSync(join(dataDir({ PITWALL_DATA_DIR: dir }).recordings, basename(SEGMENT)))).toBe(true);
    expect(dump(dir)['sessions']).toHaveLength(1);
    expect(await runCli(['import', SEGMENT], { PITWALL_DATA_DIR: dir })).toMatchObject({ code: 1, stderr: expect.stringContaining('is already imported') });
  });
});
