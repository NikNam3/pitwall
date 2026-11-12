// One writer (SP4.3a Task 6, P3; C58, C62c, C73, C75): the running bridge is the profile store's only writer while it
// runs. `serve` opens the store on its data dir and applies the driver-profile uiActions it receives over its WebSocket,
// answering each with its result; an applied action reaches the next session start, which reads the person files again.
// A live `serve` here runs on a temporary data dir (C84) whose database holds one stored session: a session in which the
// segment's player car (its name and race number as the segment's Participants give them) was driven by a human.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@pitwall/contracts';
import { feedId, type DriverPerson, type DriversProfilesValue, type ProfileSnapshot, type SessionRef, type SessionUid } from '@pitwall/domain';
import { decode, PacketId } from '@pitwall/protocol';
import { serve } from '../../src/cli/serve.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { SEGMENT } from '../helpers/cli.ts';
import { car, keyOf, lap, log, session, slot, span } from '../storage/records.ts';

const F = feedId('live');

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

type Records = Array<{ bytes: Uint8Array; receivedAtMs: number }>;

/** The segment's records as a live source gets them, and its player car as its first Participants packet names it. */
async function segment(): Promise<{ records: Records; player: { carId: number; teamId: number; raceNumber: number; name: string } }> {
  const records: Records = [];
  let player: { carId: number; teamId: number; raceNumber: number; name: string } | undefined;
  for await (const record of readPwrec(SEGMENT)) {
    records.push({ bytes: record.payload, receivedAtMs: record.t });
    const decoded = player === undefined ? decode(record.payload) : undefined;
    if (decoded?.ok === true && decoded.packet.packetId === PacketId.participants) {
      const carId = decoded.packet.header.playerCarIndex;
      const p = decoded.packet.participants[carId]!;
      player = { carId, teamId: p.teamId, raceNumber: p.raceNumber, name: p.name };
    }
  }
  if (player === undefined || player.name === '') throw new Error('the segment names no player car');
  return { records, player };
}

/**
 * A live `serve` on a temporary data dir whose database holds the stored session `seed` (its feed's player car the
 * segment's, with the segment player's team, race number and name, in one `human` car-driver span), and a WebSocket
 * client subscribed to `drivers.profiles`. `push(from, to)` hands the source records `[from, to)`; `stop()` ends the
 * session and `serve`.
 */
async function liveServe() {
  const { records, player } = await segment();
  const dataDir = mkdtempSync(join(tmpdir(), 'serve-drivers-'));
  const uiDir = join(dataDir, 'ui');
  const recordingsDir = join(dataDir, 'recordings');
  for (const dir of [uiDir, recordingsDir]) mkdirSync(dir, { recursive: true });
  const db = openDatabase(join(dataDir, 'live.db'));
  const writer = new StorageWriter(db, { onError: (error) => { throw error; }, rulesVersion: 'unversioned' });
  const seed = session('seed', {
    weekendId: 'W0', playerCar: car(player.carId), startedAt: '2026-10-01T20:00:00.000Z', pwrecPath: null, settings: { aiDifficulty: 90 },
    cars: [slot(player.carId, { teamId: player.teamId, raceNumber: player.raceNumber }, player.name)],
  });
  writer.upsertSession(seed);
  writer.writeLog(keyOf(seed), log({
    laps: [lap(player.carId, 1, { frame: 10 }), lap(player.carId, 2, { frame: 20 })],
    spans: { 'car-driver': [span('car-driver', 'human', { carId: car(player.carId), startFrame: 0, endFrame: 30 })] },
  }));
  writer.complete(keyOf(seed));

  const source = new ManualSource(F);
  const out: string[] = [];
  const abort = new AbortController();
  const done = serve({
    source,
    feed: { kind: 'udp', label: 'live' },
    wsPort: 0,
    dumpsDir: join(dataDir, 'dumps'),
    uiDir,
    storage: { db, recordingsDir, rulesVersion: 'unversioned' },
    io: { out: (line) => out.push(line), err: () => {}, env: {}, signal: abort.signal },
  });
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    await done;
  };
  cleanup.push(stop);
  await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 15_000 });
  const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate());
  ws.send(JSON.stringify({ type: 'subscribe', id: 'profiles', topic: 'drivers.profiles', params: {} }));
  /** Every `drivers.profiles` value the client got, in order. */
  const profiles = (): DriversProfilesValue[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === 'profiles' && 'value' in m ? [m.value as DriversProfilesValue] : []));
  const send = async (id: string, action: unknown): Promise<ServerMessage> => {
    ws.send(JSON.stringify({ type: 'uiAction', id, action }));
    return vi.waitFor(() => {
      const message = got.find((m) => m.type === 'actionResult' && m.id === id);
      if (message === undefined) throw new Error(`no answer to ${id}`);
      return message;
    });
  };
  const push = (from: number, to: number): void => {
    for (const record of records.slice(from, to)) source.push(record.bytes, record.receivedAtMs);
  };
  const seedRef: SessionRef = { sessionUid: 'seed' as SessionUid, weekendId: 'W0', feedCar: car(player.carId) };
  return { dataDir, recordingsDir, player, seedRef, send, profiles, push, stop, total: records.length };
}

describe('serve: the running bridge applies driver-profile actions (P3, C62c)', { timeout: 60_000 }, () => {
  it('an action sent to the running bridge is applied by it and reaches the next session start', async () => {
    const live = await liveServe();

    // Applied by the running bridge: answered, written, published.
    expect(await live.send('add', { kind: 'drivers.add', person: 'anna', displayName: 'Anna' })).toEqual({ type: 'actionResult', id: 'add', ok: true });
    expect(await live.send('link', { kind: 'drivers.link', team: live.player.teamId, raceNumber: live.player.raceNumber, person: 'anna' }))
      .toEqual({ type: 'actionResult', id: 'link', ok: true });
    // A rejected action is answered with its reason (C73).
    expect(await live.send('bad', { kind: 'drivers.override', person: 'nobody', key: 'x', value: 1 })).toMatchObject({ type: 'actionResult', id: 'bad', ok: false, reason: 'invalid' });
    const file = JSON.parse(readFileSync(join(live.dataDir, 'drivers', 'anna.json'), 'utf8')) as DriverPerson;
    expect(file).toMatchObject({ id: 'anna', displayName: 'Anna', links: [{ kind: 'nameAndNumber', name: live.player.name, raceNumber: live.player.raceNumber }] });
    await vi.waitFor(() => expect(live.profiles().at(-1)?.persons.map((p) => p.person)).toEqual(['anna']));

    // The next session starts on the link: its player car's slot carries the linked name and race number.
    live.push(0, live.total);
    await live.stop();
    const recordings = readdirSync(live.recordingsDir).filter((name) => name.endsWith('.pwrec.gz'));
    expect(recordings).toHaveLength(1);
    const snapshot = JSON.parse(readFileSync(join(live.recordingsDir, `${recordings[0]!}.profiles.json`), 'utf8')) as ProfileSnapshot;
    expect(snapshot.bySlot[live.player.carId]).toBe('anna');
    expect(snapshot.profiles['anna']).toMatchObject({ person: 'anna', displayName: 'Anna' });
  });
});
