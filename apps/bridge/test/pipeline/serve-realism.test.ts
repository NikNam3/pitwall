// `serve` for a replay: the recording's sidecar decides realism, never the UI's next-session preference
// (spec 7.9: "saves it in that session's config sidecar, so replays reproduce it"; determinism).
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage, SessionInfo } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { serve } from '../../src/cli/serve.ts';
import { effectiveConfig, recordingConfig, sessionConfigPath } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { WsClient } from '../../src/ws/client.ts';
import { SEGMENT } from '../helpers/cli.ts';

/** Replays a copy of the segment whose sidecar says `sidecar`, with a UI state whose realism preference is `ui`; returns session.info.realism. */
async function realismOfReplay(sidecar: boolean, ui: boolean): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), 'serve-realism-'));
  const file = join(dir, 'race.pwrec.gz');
  copyFileSync(SEGMENT, file);
  writeFileSync(sessionConfigPath(file), JSON.stringify({ realism: { enabled: sidecar } }));
  const uiDir = join(dir, 'ui');
  mkdirSync(uiDir);
  writeFileSync(join(uiDir, 'state.json'), JSON.stringify({ activeWorkbook: 'default', linkGroups: [], acknowledged: [], muted: [], realism: ui }));
  const out: string[] = [];
  const abort = new AbortController();
  const done = serve({
    replay: { feedId: feedId('replay'), path: file, controls: [{ kind: 'pause' }], unpaced: true },
    feed: { kind: 'replay', label: 'race' },
    wsPort: 0,
    dumpsDir: join(dir, 'dumps'),
    uiDir,
    config: recordingConfig(file, FEATURES, effectiveConfig(FEATURES)),
    io: { out: (line) => out.push(line), err: () => {}, env: {}, signal: abort.signal },
  });
  try {
    await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 15_000 });
    const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
    const client = WsClient.connect(`ws://127.0.0.1:${port}`, { reconnectMs: 50 });
    const got: SessionInfo[] = [];
    client.subscribe('session.info', {}, (m: ServerMessage) => {
      if ((m.type === 'snapshot' || m.type === 'update') && 'value' in m) got.push(m.value as SessionInfo);
    }, feedId('replay'));
    await vi.waitFor(() => expect(got.length).toBeGreaterThan(0), { timeout: 10_000 });
    client.close();
    return got.at(-1)!.realism;
  } finally {
    abort.abort();
    await done;
  }
}

describe('serve: a replay ignores the UI realism preference', { timeout: 40_000 }, () => {
  it('sidecar realism off, UI preference on: the replay runs with realism off', async () => {
    expect(await realismOfReplay(false, true)).toBe(false);
  });
  it('sidecar realism on, UI preference off: the replay runs with realism on', async () => {
    expect(await realismOfReplay(true, false)).toBe(true);
  });
});
