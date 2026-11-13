// Several feeds in one bridge (SP4.3b Task 2b; C1a, C58, C60, spec 8.5): `PITWALL_UDP_PORT` is a comma-separated list,
// one feed per port. `pitwall live` opens one UDP source and one feed pipeline per port (feed id `udp-<port>`), one hub
// and one WebSocket server; `hello` lists every feed, each with its player car's team once Participants name it.
// Builder sessions are sent over UDP to a live bridge on a temporary data dir (C84).
import { createSocket } from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FeedInfo, ServerMessage, SessionInfo } from '@pitwall/contracts';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { startCli } from '../helpers/cli.ts';

const HOST = '127.0.0.1';
const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-feeds-'));

/** `n` UDP ports that were free a moment ago. */
async function freePorts(n: number): Promise<number[]> {
  const sockets = Array.from({ length: n }, () => createSocket('udp4'));
  const ports = await Promise.all(sockets.map((s) => new Promise<number>((r) => s.bind(0, HOST, () => r(s.address().port)))));
  await Promise.all(sockets.map((s) => new Promise<void>((r) => s.close(() => r()))));
  return ports;
}

/** A builder session of four cars (teams by slot: 3, 3, 4, 4), `uid`, player car `player`, as UDP payloads. */
const session = (uid: bigint, player: number): Uint8Array[] =>
  new ScenarioBuilder({ sessionUid: uid, cars: 4, player })
    .participants({ participants: [3, 3, 4, 4].map((teamId) => ({ teamId })) })
    .frames(20, () => {})
    .packets()
    .map(({ packet }) => packetBytes(packet));

/** Sends `payloads` to `port`, one after the other. */
async function send(port: number, payloads: readonly Uint8Array[]): Promise<void> {
  const socket = createSocket('udp4');
  try {
    for (const payload of payloads) await new Promise<void>((r, j) => socket.send(payload, port, HOST, (e) => (e ? j(e) : r())));
  } finally {
    socket.close();
  }
}

/** A WebSocket client: every message it got, and `subscribe` (with or without a feed id). */
async function client(wsPort: number) {
  const ws = new WebSocket(`ws://${HOST}:${wsPort}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  const subscribe = (id: string, feedId?: string): void => {
    ws.send(JSON.stringify({ type: 'subscribe', id, topic: 'session.info', params: {}, ...(feedId !== undefined && { feedId }) }));
  };
  const infos = (id: string): SessionInfo[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m && m.value !== undefined ? [m.value as SessionInfo] : []));
  const hello = async (): Promise<FeedInfo[]> => vi.waitFor(() => {
    const message = got.find((m) => m.type === 'hello');
    if (message?.type !== 'hello') throw new Error('no hello');
    return message.feeds;
  });
  return { subscribe, infos, hello, close: () => ws.terminate() };
}

/** The `hello` feeds of a fresh connection, once `ready` holds for them. */
async function helloOnce(wsPort: number, ready: (feeds: FeedInfo[]) => boolean): Promise<FeedInfo[]> {
  return vi.waitFor(async () => {
    const c = await client(wsPort);
    try {
      const feeds = await c.hello();
      if (!ready(feeds)) throw new Error(`feeds not ready: ${JSON.stringify(feeds)}`);
      return feeds;
    } finally {
      c.close();
    }
  }, { timeout: 15_000, interval: 200 });
}

/** A live bridge on `ports` (comma-separated, in order) and a temporary data dir; resolves with its WebSocket port. */
async function live(ports: readonly number[]) {
  const dir = tmp();
  const cli = startCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: ports.join(','), PITWALL_UDP_HOST: HOST, PITWALL_DATA_DIR: dir });
  const [, wsPort] = (await cli.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/, 20_000))!;
  return { dir, cli, wsPort: Number(wsPort) };
}

describe('pitwall live: one feed per UDP port', { timeout: 60_000 }, () => {
  it('two ports give two feeds with their own pipelines, one hub and one WebSocket; topics carry their feedId', async () => {
    const [p1, p2] = (await freePorts(2)) as [number, number];
    const bridge = await live([p1, p2]);
    await send(p1, session(7n, 0));
    await send(p2, session(7n, 1));

    const feeds = await helloOnce(bridge.wsPort, (f) => f.length === 2 && f.every((feed) => feed.team !== null));
    expect(feeds).toHaveLength(2);
    expect(feeds).toEqual(expect.arrayContaining([
      expect.objectContaining({ feedId: `udp-${p1}`, kind: 'udp', label: `UDP port ${p1}`, team: 3 }),
      expect.objectContaining({ feedId: `udp-${p2}`, kind: 'udp', label: `UDP port ${p2}`, team: 3 }),
    ]));

    // One WebSocket serves both feeds; each subscription gets its own feed's session.
    const c = await client(bridge.wsPort);
    c.subscribe('one', `udp-${p1}`);
    c.subscribe('two', `udp-${p2}`);
    await vi.waitFor(() => expect(c.infos('one').length * c.infos('two').length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(c.infos('one').at(-1)).toMatchObject({ feedId: `udp-${p1}`, sessionUid: '7', playerCar: 0 });
    expect(c.infos('two').at(-1)).toMatchObject({ feedId: `udp-${p2}`, sessionUid: '7', playerCar: 1 });
    c.close();
    expect(await bridge.cli.stop()).toBe(0);
  });

  it('one port behaves as today', async () => {
    const [p] = (await freePorts(1)) as [number];
    const bridge = await live([p]);
    await send(p, session(9n, 2));

    // A subscription without a feed id gets the one feed.
    const c = await client(bridge.wsPort);
    c.subscribe('info');
    await vi.waitFor(() => expect(c.infos('info').length).toBeGreaterThan(0), { timeout: 10_000 });
    expect(c.infos('info').at(-1)).toMatchObject({ feedId: `udp-${p}`, sessionUid: '9', playerCar: 2 });
    c.close();
    // The one feed as before, its team filled from Participants.
    const feeds = await helloOnce(bridge.wsPort, (f) => f.every((feed) => feed.team !== null));
    expect(feeds).toEqual([expect.objectContaining({ feedId: `udp-${p}`, kind: 'udp', label: `UDP port ${p}`, team: 4 })]);
    expect(await bridge.cli.stop()).toBe(0);
  });

  it('storage keeps both feeds of one session side by side (C60)', async () => {
    const [p1, p2] = (await freePorts(2)) as [number, number];
    const bridge = await live([p1, p2]);
    await send(p1, session(7n, 0));
    await send(p2, session(7n, 1));
    await helloOnce(bridge.wsPort, (f) => f.length === 2 && f.every((feed) => feed.team !== null));
    expect(await bridge.cli.stop()).toBe(0);

    const db = new Database(dataDir({ PITWALL_DATA_DIR: bridge.dir }).dbPath, { readonly: true });
    try {
      const rows = db.prepare('SELECT session_uid, player_car FROM sessions ORDER BY player_car').all();
      expect(rows).toEqual([{ session_uid: '7', player_car: 0 }, { session_uid: '7', player_car: 1 }]);
      const cars = db.prepare('SELECT player_car, count(*) AS n FROM cars GROUP BY player_car ORDER BY player_car').all();
      expect(cars).toEqual([{ player_car: 0, n: 22 }, { player_car: 1, n: 22 }]);
    } finally {
      db.close();
    }
  });
});
