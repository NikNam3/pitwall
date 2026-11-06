// The startup server (C61 "with progress shown", C58): while `pitwall live` rebuilds stored sessions, before the database
// opens and before `serve` binds, a small WebSocket server on the bridge's port tells every client what it is doing:
// `{ type: 'starting', step: 'rebuild', done, total }`, the newest on connect and each change to every client. It answers
// a `heartbeat` with a `heartbeat`, ignores every other client message, and its `close` disconnects its clients and frees
// the port, so the UI's connection reconnects to the bridge that serves.
//
// Contract the tests assume of `apps/bridge/src/cli/startup-server.ts`, after `WsServer`:
//  - `StartupServer.start({ port, host? }): Promise<StartupServer>` (host defaults to 127.0.0.1; port 0 picks one);
//  - `server.port`: the bound port; `server.progress(done, total)`: the newest progress (before any call: 0 of 0);
//  - `server.close(): Promise<void>`: resolves once the clients are disconnected and the port is free again.
import { createServer } from 'node:net';
import { decodeServerMessage, type ServerMessage } from '@pitwall/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { StartupServer } from '../../src/cli/startup-server.ts';

/** A client of the startup server: every message it got, in order, and whether its socket closed. */
type Client = { socket: WebSocket; messages: ServerMessage[]; closed: Promise<void> };

const connect = async (port: number): Promise<Client> => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => {
    const message = decodeServerMessage(data.toString());
    if (message !== undefined) messages.push(message);
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, messages, closed };
};

/** Waits until `client` holds `count` messages (the server is in this process: a few event-loop turns at most). */
const received = async (client: Client, count: number): Promise<ServerMessage[]> => {
  const t0 = Date.now();
  while (client.messages.length < count) {
    if (Date.now() - t0 > 5_000) throw new Error(`got ${JSON.stringify(client.messages)}, wanted ${count} messages`);
    await new Promise((r) => setTimeout(r, 5));
  }
  return client.messages;
};

const starting = (done: number, total: number): ServerMessage => ({ type: 'starting', step: 'rebuild', done, total });

/** Whether a plain TCP server can bind `port` on 127.0.0.1 now. */
const bindable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

const open: StartupServer[] = [];
const start = async (): Promise<StartupServer> => {
  const server = await StartupServer.start({ port: 0 });
  open.push(server);
  return server;
};
const clients: Client[] = [];
const client = async (server: StartupServer): Promise<Client> => {
  const c = await connect(server.port);
  clients.push(c);
  return c;
};

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.terminate();
  for (const s of open.splice(0)) await s.close().catch(() => {});
});

describe('the startup server (C61)', { timeout: 15_000 }, () => {
  it('sends 0 of 0 on connect before it knows the count', async () => {
    const server = await start();
    const c = await client(server);
    expect(await received(c, 1)).toEqual([starting(0, 0)]);
  });

  it('sends the newest progress on connect', async () => {
    const server = await start();
    server.progress(0, 4);
    server.progress(2, 4);
    const c = await client(server);
    expect(await received(c, 1)).toEqual([starting(2, 4)]);
  });

  it('sends each change to every client', async () => {
    const server = await start();
    server.progress(0, 3);
    const a = await client(server);
    const b = await client(server);
    await received(a, 1);
    await received(b, 1);
    server.progress(1, 3);
    server.progress(2, 3);
    expect(await received(a, 3)).toEqual([starting(0, 3), starting(1, 3), starting(2, 3)]);
    expect(await received(b, 3)).toEqual([starting(0, 3), starting(1, 3), starting(2, 3)]);
  });

  it('never sends a hello: it does not serve', async () => {
    const server = await start();
    const c = await client(server);
    server.progress(1, 1);
    await received(c, 2);
    expect(c.messages.some((m) => m.type === 'hello')).toBe(false);
  });

  it('answers a heartbeat with a heartbeat and ignores every other client message', async () => {
    const server = await start();
    const c = await client(server);
    await received(c, 1);
    c.socket.send(JSON.stringify({ type: 'subscribe', id: 's1', topic: 'laps', params: {}, feedId: 'f1' }));
    c.socket.send('not json');
    c.socket.send(JSON.stringify({ type: 'heartbeat' }));
    expect(await received(c, 2)).toEqual([starting(0, 0), { type: 'heartbeat' }]);
    // nothing else follows: no error, no answer to the subscribe
    await new Promise((r) => setTimeout(r, 50));
    expect(c.messages).toHaveLength(2);
  });

  it('close disconnects its clients and frees the port', async () => {
    const server = await start();
    const port = server.port;
    const a = await client(server);
    const b = await client(server);
    await server.close();
    open.length = 0;
    await Promise.all([a.closed, b.closed]);
    expect(await bindable(port)).toBe(true);
  });

  it('binds the port it is given', async () => {
    const probe = await StartupServer.start({ port: 0 });
    const port = probe.port;
    await probe.close();
    const server = await StartupServer.start({ port });
    open.push(server);
    expect(server.port).toBe(port);
    expect(await bindable(port)).toBe(false);
  });
});
