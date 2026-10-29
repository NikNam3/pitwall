// `pitwall dev` restores the moment (spec 10, UI shell spec 9.3): after a source change the bridge restarts and the
// replay is where it was, with data on the topics the panels read. Needs no Electron: a WebSocket client stands in for the UI.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ReplayStatus } from '@pitwall/contracts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const BRIDGE_CLI = path.join(REPO_ROOT, 'apps/bridge/src/cli/pitwall.ts');
const SEGMENT = path.join(REPO_ROOT, 'fixtures/segments/tt-zandvoort-lap1.pwrec.gz');
/**
 * A new, untracked source file in a watched folder: writing it is the change, `finally` removes it. No tracked file is
 * edited, so a killed run leaves at most this comment-only file behind. Any other `pitwall dev` running in this
 * checkout restarts too: the change is real.
 */
const TOUCH_FILE = path.join(REPO_ROOT, 'apps/bridge/src/dev/.dev-restart-touch.ts');
/** How often the replay child reports its position to the supervisor. */
const POSITION_INTERVAL_MS = 500;
/** Inside the segment (session time 112 s to 118 s). */
const SEEK_MS = 116_000;
const TOLERANCE_MS = 1_000;
/** The restart runs `pnpm gen` first. */
const RESTART_TIMEOUT_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

type Wire = { type: string; id?: string; value?: unknown; feeds?: Array<{ feedId: string; kind: string }> };

/** A client of the bridge: `ask` subscribes to a topic and resolves with its first message, `send` sends a raw message. */
async function connect(port: number): Promise<{ closed: Promise<void>; feedId: string; ask(topic: string): Promise<Wire>; send(message: object): void; close(): void }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve(), { once: true }));
  const messages: Wire[] = [];
  const waiting: Array<() => void> = [];
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)) as Wire);
    for (const wake of waiting.splice(0)) wake();
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`no WebSocket on ${port}`)), { once: true });
  });
  const next = async (match: (m: Wire) => boolean): Promise<Wire> => {
    for (const deadline = Date.now() + 10_000; Date.now() < deadline; ) {
      const at = messages.findIndex(match);
      if (at >= 0) return messages.splice(at, 1)[0] as Wire;
      await Promise.race([new Promise<void>((resolve) => waiting.push(resolve)), sleep(200)]);
    }
    throw new Error('no matching message in 10 s');
  };
  const hello = await next((m) => m.type === 'hello');
  const feedId = hello.feeds?.find((f) => f.kind === 'replay')?.feedId;
  if (feedId === undefined) throw new Error('the bridge offers no replay feed');
  let counter = 0;
  return {
    closed,
    feedId,
    send: (message) => socket.send(JSON.stringify(message)),
    ask: async (topic) => {
      const id = `s${++counter}`;
      socket.send(JSON.stringify({ type: 'subscribe', id, topic, params: {}, feedId }));
      const answer = await next((m) => m.id === id && (m.type === 'snapshot' || m.type === 'topicStatus'));
      socket.send(JSON.stringify({ type: 'unsubscribe', id }));
      return answer;
    },
    close: () => socket.close(),
  };
}

/** Retries `connect` while the bridge restarts. */
async function connectWhenUp(port: number): Promise<Awaited<ReturnType<typeof connect>>> {
  for (const deadline = Date.now() + RESTART_TIMEOUT_MS; ; await sleep(300)) {
    try {
      return await connect(port);
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
  }
}

const statusOf = async (client: Awaited<ReturnType<typeof connect>>): Promise<ReplayStatus | undefined> => {
  const answer = await client.ask('replay.status');
  return answer.type === 'snapshot' ? (answer.value as ReplayStatus) : undefined;
};

test('pitwall dev restores the replay moment after a source file changes', async () => {
  const port = await freePort();
  const output: string[] = [];
  const child: ChildProcess = spawn(process.execPath, [BRIDGE_CLI, 'dev', '--replay', SEGMENT, '--at-lap', '2'], {
    cwd: REPO_ROOT,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_OPTIONS')), PITWALL_WS_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => output.push(String(chunk)));
  try {
    let client = await connectWhenUp(port);
    // Seek, then pause so the moment stands still while the restart is prepared.
    client.send({ type: 'replayControl', id: 'c1', control: { kind: 'jumpToTime', sessionTimeMs: SEEK_MS } });
    client.send({ type: 'replayControl', id: 'c2', control: { kind: 'pause' } });
    const settled = (s: ReplayStatus | undefined): boolean => s?.paused === true && Math.abs(s.sessionTimeMs - SEEK_MS) <= TOLERANCE_MS;
    await expect.poll(async () => settled(await statusOf(client)), { timeout: RESTART_TIMEOUT_MS, message: output.join('') }).toBe(true);
    const firstSession = (await statusOf(client))?.sessionTimeMs ?? 0;
    // The supervisor learns the position from the child's next report: one interval after the replay stood still.
    await sleep(POSITION_INTERVAL_MS * 2);

    await writeFile(TOUCH_FILE, '// written by dev-restart.spec.ts, removed when it ends\n');

    // The old child going away is the restart: its socket closes. A new child then listens on the same port.
    await Promise.race([client.closed, sleep(RESTART_TIMEOUT_MS).then(() => Promise.reject(new Error(`the bridge did not restart\n${output.join('')}`)))]);
    client.close();
    client = await connectWhenUp(port);
    const after = await statusOf(client);
    expect(after, `the restarted replay reports its position\n${output.join('')}`).toBeDefined();
    expect(Math.abs((after?.sessionTimeMs ?? 0) - firstSession)).toBeLessThanOrEqual(TOLERANCE_MS);
    // The panels show data again: topics of the feed answer with values, not noData.
    for (const topic of ['session.info', 'feed.status', 'cars.overview']) {
      const answer = await client.ask(topic);
      expect(answer.type, `${topic} after the restart`).toBe('snapshot');
    }
    client.close();
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    child.kill('SIGKILL');
    await rm(TOUCH_FILE, { force: true });
  }
});
