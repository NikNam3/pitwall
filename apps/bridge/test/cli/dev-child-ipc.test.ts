// The `pitwall replay --dev` child reports `{ type: 'position', sessionTimeMs, paused, speed }` over IPC (Task 7).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI, SEGMENT } from '../helpers/cli.ts';

describe('pitwall replay --dev as an IPC child', { timeout: 20_000 }, () => {
  it('sends position messages with the transport state while paused', async () => {
    const child = spawn(process.execPath, [CLI, 'replay', SEGMENT, '--dev', '--paused', '--speed', '2', '--at-time', '115000'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-ipc-')) },
    });
    try {
      const messages: unknown[] = [];
      child.on('message', (m) => messages.push(m));
      const t0 = Date.now();
      while (messages.length < 2 && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 25));
      expect(messages.length).toBeGreaterThanOrEqual(2);
      for (const m of messages) {
        expect(m).toMatchObject({ type: 'position', paused: true, speed: 2 });
        expect((m as { sessionTimeMs: number }).sessionTimeMs).toBeGreaterThanOrEqual(115_000);
        expect((m as { sessionTimeMs: number }).sessionTimeMs).toBeLessThan(117_900);
      }
    } finally { child.kill('SIGKILL'); }
  });
});
