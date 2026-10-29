// A replay that starts with a jump (`--at-time`, as `pitwall dev` restarts it) accepts clients only once it has landed,
// so the first status a client sees is the moment asked for, not a position the fast-forward passes through.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, SEGMENT } from '../helpers/cli.ts';

const AT_MS = 116_015;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Connects as soon as the port answers and returns the first `replay.status` value. */
function firstStatus(port: number): Promise<{ sessionTimeMs: number; paused: boolean }> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const attempt = (): void => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      socket.addEventListener('error', () => (Date.now() > deadline ? reject(new Error('no WebSocket')) : setTimeout(attempt, 5)));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; id?: string; feeds?: Array<{ feedId: string }>; value?: { sessionTimeMs: number; paused: boolean } };
        if (message.type === 'hello') {
          socket.send(JSON.stringify({ type: 'subscribe', id: 'a', topic: 'replay.status', params: {}, feedId: message.feeds?.[0]?.feedId }));
        } else if (message.id === 'a' && message.value) {
          socket.close();
          resolve(message.value);
        }
      });
    };
    attempt();
  });
}

describe('pitwall replay with a startup jump', { timeout: 30_000 }, () => {
  it('shows the jump target to the first client that can connect', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [CLI, 'replay', SEGMENT, '--paused', '--realtime', '--at-time', String(AT_MS)], {
      stdio: 'ignore',
      env: { ...process.env, PITWALL_WS_PORT: String(port), PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-jump-')) },
    });
    try {
      const status = await firstStatus(port);
      expect(status.paused).toBe(true);
      expect(status.sessionTimeMs).toBeGreaterThanOrEqual(AT_MS);
      expect(status.sessionTimeMs).toBeLessThan(AT_MS + 1_000);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
