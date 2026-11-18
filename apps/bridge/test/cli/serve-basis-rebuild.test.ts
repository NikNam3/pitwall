// `serve` hands the basis the bridge's rebuild service (SP4.3e Task 7a-2 fix round; C61, C62; spec §4.3 item 3a): the
// live command passes `StaleSessions`' rebuild service to `serve` as `storage.rebuildService`
// (`Pick<RebuildService, 'ensureCurrent'>`), and the basis's `ensureCurrent` reaches it with its priority (`runningBasis`
// before `planning` before `firstRead`), not through the row-based queue of `storage.rebuild`, which drops it. A live
// `serve` on a temporary data dir (C84) with builder sessions: the seat's practice of an earlier weekend is stale; the
// race is in a lobby of its own (no preselection), and a `basis.choose` names that practice.
//
// `storage.rebuildService` is a new option: the storage value is built outside the call, so this compiles before it
// exists and fails at run time.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { serve } from '../../src/cli/serve.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { AT, builder, fakeRebuild, keyOf, markStale, RACE_UID, RULES, SESSION_TYPE, slice, storeSession } from '../pipeline/basis-support.ts';

const F = feedId('live');
const EARLIER = 60;
const LOBBY = 61;

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

describe('serve: the basis reaches the rebuild service with its priority (C61)', { timeout: 60_000 }, () => {
  it("serve's basis confirm reaches the rebuild service (storage.rebuildService) with priority runningBasis", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'serve-basis-rebuild-'));
    const uiDir = join(dataDir, 'ui');
    const recordingsDir = join(dataDir, 'recordings');
    for (const dir of [uiDir, recordingsDir]) mkdirSync(dir, { recursive: true });
    const db = openDatabase(join(dataDir, 'live.db'));
    const practice = await storeSession(db, { uid: 62n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const key = keyOf(practice, 0);
    markStale(db, key);
    const rebuild = fakeRebuild(db);
    const storage = { db, recordingsDir, rulesVersion: RULES, rebuildService: rebuild.service };

    const source = new ManualSource(F);
    const out: string[] = [];
    const abort = new AbortController();
    const done = serve({
      sources: [{ source, feed: { kind: 'udp', label: 'live' } }],
      wsPort: 0,
      dumpsDir: join(dataDir, 'dumps'),
      uiDir,
      storage,
      io: { out: (line) => out.push(line), err: () => {}, env: {}, signal: abort.signal },
    });
    cleanup.push(async () => {
      abort.abort();
      await done;
    });
    await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 15_000 });
    const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: ServerMessage[] = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
    await new Promise((r) => ws.once('open', r));
    cleanup.push(() => ws.terminate());

    // the race runs, its team known
    const packets = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(12, () => {}).packets();
    for (const { packet, receivedAtMs } of slice(packets, 0, 8)) source.push(packetBytes(packet), receivedAtMs);
    await new Promise((r) => setTimeout(r, 300));

    // the plan kept (no `plan`): `serve` here has no saved plans
    const basis = { practice: [practice], qualifying: null };
    ws.send(JSON.stringify({ type: 'uiAction', id: 'choose', action: { kind: 'basis.choose', feedId: F, basis } }));
    const answer = await vi.waitFor(() => {
      const message = got.find((m) => m.type === 'actionResult' && m.id === 'choose');
      if (message === undefined) throw new Error('no answer to choose');
      return message;
    }, { timeout: 10_000 });
    expect(answer).toMatchObject({ ok: true });

    // the named stale session reached the service at the running basis's priority
    const asked = rebuild.calls.filter((c) => c.priority === 'runningBasis').flatMap((c) => c.refs);
    expect(asked).toContainEqual(key);
  });
});
