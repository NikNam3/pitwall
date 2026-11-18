// SP4.3f Task 8, case A regression (spec §4.2 "Case A", §4.5; C38, C62d, C84): a qualifying that ends in a live run
// opens its planning round by itself, with every pick preselected. The committed segment `qualifying-texas-2026-end-dr`
// (the DR feed's Texas short qualifying of 2026-11-17, its last seconds; the player car slot 1, team 0, #2; its Session
// packets carry the race's samples) is replayed live-like: a `PwrecSource` (paced off) as a UDP feed of `serve`, so the
// run stores the session and its end (the end of the input) is a live session end. Before it, a synthetic practice of
// the same weekend and seat (team 0, #2 in slot 1, track 15) is imported into the fresh data dir (`pitwall import`), so
// the session's basis has a practice (C62). At the end `plans.prepared` opens with the qualifying's team, the basis's
// practice, sets `carried`, conditions `IMPORTED` and the qualifying's race samples as the forecast rows.
// The planning job is the echo stub (`planning-stub-job.ts`): this checks the round's picks, not the model.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { PlanningRoundState, ServerMessage } from '@pitwall/contracts';
import { feedId, IMPORTED, type StrategyOutput } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { writeSynthetic } from '../../../../test-support/recordings/index.ts';
import { SEGMENTS } from '../../../../test-support/segments.ts';
import { run as importRecording } from '../../src/cli/commands/import.ts';
import { serve } from '../../src/cli/serve.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { dataDir as dataDirOf } from '../../src/storage/data-dir.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { rulesVersion, SOURCE_ROOT } from '../../src/storage/rules-version.ts';

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments', SEGMENTS.qualifyingTexas2026EndDr);
const FEED = feedId('udp-29101');
/** The segment's session (fixtures/index.json): Texas, weekend 548397152; the player's seat team 0, #2 in slot 1. */
const TRACK = 15;
const WEEKEND = 548397152;
const TEAM = 0;
const QUALIFYING = { sessionUid: '12101553556244014932', weekendId: String(WEEKEND) };
/** The synthetic practice of that weekend and seat. */
const PRACTICE_UID = 0xe2e0a1n;
const PRACTICE = { sessionUid: PRACTICE_UID.toString(), weekendId: String(WEEKEND) };

const ECHO_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: 'planning',
  reads: [],
  trigger: 'frame',
  prepare: () => {
    throw new Error('the planning runner builds the input itself (planningInputFrom)');
  },
  module: new URL('./planning-stub-job.ts', import.meta.url),
};

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

const io = (env: NodeJS.ProcessEnv, out: string[] = [], signal = new AbortController().signal) => ({
  out: (line: string) => out.push(line),
  err: () => {},
  env,
  signal,
});

describe('case A: a qualifying\'s live end opens its round with every pick preselected (SP4.3f Task 8; C62d)', { timeout: 120_000 }, () => {
  it('the committed qualifying segment, replayed live-like, opens plans.prepared with team 0, the basis\'s practice, carried, IMPORTED and known forecast rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pitwall-case-a-'));
    const env = { PITWALL_DATA_DIR: root };
    const dirs = dataDirOf(env);

    // The weekend's practice of the seat, stored as `pitwall import` stores it.
    const practiceFile = join(mkdtempSync(join(tmpdir(), 'pitwall-case-a-src-')), 'practice-case-a.pwrec.gz');
    await writeSynthetic(practiceFile, {
      sessionUid: PRACTICE_UID,
      weekendId: WEEKEND,
      trackId: TRACK,
      kind: 'practice',
      player: 1,
      cars: Array.from({ length: 20 }, (_, i) => (i === 0 ? { teamId: 0, raceNumber: 64 } : i === 1 ? { teamId: 0, raceNumber: 2 } : { teamId: 1 + Math.floor(i / 2), raceNumber: 10 + i })),
    });
    expect(await importRecording([practiceFile], {}, io(env))).toBe(0);

    // The qualifying, live-like: its packets as a UDP feed's, as fast as they are read; the input's end ends it.
    const version = await rulesVersion(SOURCE_ROOT);
    const db = openDatabase(dirs.dbPath);
    const out: string[] = [];
    const abort = new AbortController();
    const done = serve({
      sources: [{ source: new PwrecSource({ feedId: FEED, path: SEGMENT, mode: 'asFastAsPossible' }), feed: { kind: 'udp' as const, label: FEED } }],
      wsPort: 0,
      dumpsDir: dirs.dumps,
      uiDir: dirs.ui,
      storage: { db, recordingsDir: dirs.recordings, rulesVersion: version },
      planningJob: ECHO_JOB,
      io: io(env, out, abort.signal),
    });
    cleanup.push(async () => {
      abort.abort();
      await done;
    });
    await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 30_000 });
    const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: ServerMessage[] = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
    await new Promise((r) => ws.once('open', r));
    cleanup.push(() => ws.terminate());
    ws.send(JSON.stringify({ type: 'subscribe', id: 'prepared', topic: 'plans.prepared', params: {}, feedId: FEED }));
    const prepared = (): PlanningRoundState | undefined =>
      got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === 'prepared' && 'value' in m ? [m.value as PlanningRoundState] : [])).at(-1);

    // The round may publish before its replay has read the forecast (`rebuilding`, the replay running): its rows are
    // known once the replay has run.
    await vi.waitFor(() => expect(prepared()).toMatchObject({ open: true, forecast: { rows: { known: true } } }), { timeout: 15_000 });
    const round = prepared() as Extract<PlanningRoundState, { open: true }>;
    expect(round.team).toBe(TEAM);
    expect(round.trackId).toBe(TRACK);
    expect(round.qualifying).toEqual(QUALIFYING);
    expect(round.practice).toEqual([PRACTICE]);
    expect(round.race.sets).toBe('carried');
    expect(round.race.conditions).toEqual(IMPORTED);
    expect(round.forecast.rows.known).toBe(true);
    if (round.forecast.rows.known) {
      expect(round.forecast.rows.value.length).toBeGreaterThan(0);
      expect(round.forecast.rows.value.every((row) => !row.overridden)).toBe(true);
    }
  });
});
