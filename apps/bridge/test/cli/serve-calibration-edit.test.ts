// `serve` wires a calibration edit to the running session (SP4.1a Task a1; C62a, C76, C1a): after the calibration
// store accepts an edit of a set (every calibration uiAction but `calibration.set.create` and `.copy`, which make a set no
// run uses), `serve` calls `calibrationEdited(setId)` on every feed pipeline, and a run on that set commits a
// calibration-chosen decision naming its new snapshot (`test/pipeline/calibration-edit.test.ts` covers the pipeline's
// side). A recompute that is no edit (after a rebuild, at session end) reaches no pipeline. A live `serve` here runs on
// a temporary data dir (C84) holding one set, `dry`, the track's preselection; the segment's records are pushed by the
// test, so an action lands between two records of a running session.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage } from '@pitwall/contracts';
import { feedId, type CalibrationActiveValue, type CalibrationSet } from '@pitwall/domain';
import { CalibrationStore } from '../../src/calibration/store.ts';
import { serve } from '../../src/cli/serve.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { SEGMENT } from '../helpers/cli.ts';

const F = feedId('live');
const ZANDVOORT = 26;
/** The record of the segment (1778 records) before which the test acts. */
const EDIT_AT = 800;
const DRY: CalibrationSet = {
  id: 'dry', trackId: ZANDVOORT, name: 'Dry', createdAt: '2026-10-01T20:00:00.000Z', sources: [],
  overrides: { 'pitLoss.ms.green': 21_500 }, lastUsedAt: '2026-10-02T20:00:00.000Z',
};
const at = { trackId: ZANDVOORT, setId: 'dry' };

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
  vi.restoreAllMocks();
});

/** The segment's records as a live source gets them. */
async function records(): Promise<Array<{ bytes: Uint8Array; receivedAtMs: number }>> {
  const all: Array<{ bytes: Uint8Array; receivedAtMs: number }> = [];
  for await (const record of readPwrec(SEGMENT)) all.push({ bytes: record.payload, receivedAtMs: record.t });
  return all;
}

/**
 * A live `serve` on a temporary data dir with `dry` on disk, a WebSocket client subscribed to the feed's
 * `calibration.active`, and the calibration store `serve` opened. `push(from, to)` hands the source records `[from, to)`;
 * `stop()` ends the session and `serve`.
 */
async function liveServe() {
  const dataDir = mkdtempSync(join(tmpdir(), 'serve-calibration-edit-'));
  const uiDir = join(dataDir, 'ui');
  const recordingsDir = join(dataDir, 'recordings');
  for (const dir of [uiDir, recordingsDir, join(dataDir, 'calibration', String(ZANDVOORT))]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dataDir, 'calibration', String(ZANDVOORT), 'dry.json'), JSON.stringify(DRY));
  const open = vi.spyOn(CalibrationStore, 'open');
  const all = await records();
  const source = new ManualSource(F);
  const out: string[] = [];
  const abort = new AbortController();
  const done = serve({
    source,
    feed: { kind: 'udp', label: 'live' },
    wsPort: 0,
    dumpsDir: join(dataDir, 'dumps'),
    uiDir,
    storage: { db: openDatabase(join(dataDir, 'live.db')), recordingsDir, rulesVersion: 'unversioned' },
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
  const store = open.mock.results[0]?.value as CalibrationStore | undefined;
  if (store === undefined) throw new Error('serve opened no calibration store');
  const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate());
  ws.send(JSON.stringify({ type: 'subscribe', id: 'active', topic: 'calibration.active', params: {}, feedId: F }));
  /** Every `calibration.active` value the client got, in order. */
  const active = (): CalibrationActiveValue[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === 'active' && 'value' in m ? [m.value as CalibrationActiveValue] : []));
  const send = async (id: string, action: unknown): Promise<ServerMessage> => {
    ws.send(JSON.stringify({ type: 'uiAction', id, action }));
    return vi.waitFor(() => {
      const message = got.find((m) => m.type === 'actionResult' && m.id === id);
      if (message === undefined) throw new Error(`no answer to ${id}`);
      return message;
    });
  };
  const push = (from: number, to: number): void => {
    for (const record of all.slice(from, to)) source.push(record.bytes, record.receivedAtMs);
  };
  /** The newest `calibration.active` value once it matches `expected`. */
  const activeMatches = (expected: object) => vi.waitFor(() => expect(active().at(-1)).toMatchObject(expected), { timeout: 5_000 });
  return { store, push, send, active, activeMatches, stop, recordingsDir, total: all.length };
}

describe('serve: a calibration edit reaches the running session (C62a, C76)', { timeout: 60_000 }, () => {
  it('an edit of the set in use commits a calibrationChosen decision for its new snapshot', async () => {
    const live = await liveServe();
    live.push(0, EDIT_AT);
    const start = live.store.snapshotOf(ZANDVOORT, 'dry')?.fingerprint;
    expect(start).toBeDefined();
    await live.activeMatches({ known: true, value: { setId: 'dry', snapshot: start, picked: false } });

    // a new set and a copy of the set in use make sets no run uses: the run stays as it is
    expect(await live.send('create', { kind: 'calibration.set.create', trackId: ZANDVOORT, name: 'Wet' })).toMatchObject({ ok: true });
    expect(await live.send('copy', { kind: 'calibration.set.copy', ...at, name: 'Dry copy' })).toMatchObject({ ok: true });
    // a rejected edit changes nothing (C73)
    expect(await live.send('bad', { kind: 'calibration.override.set', ...at, key: 'pitLoss.ms.green', value: 1 })).toMatchObject({ ok: false, reason: 'invalid' });
    live.push(EDIT_AT, EDIT_AT + 50);
    await live.activeMatches({ known: true, value: { setId: 'dry', snapshot: start, picked: false } });
    expect(live.active().every((value) => value.known && value.value.snapshot === start)).toBe(true);

    // an edit of the set in use: the run switches to the set's new snapshot, as a pick does
    expect(await live.send('edit', { kind: 'calibration.override.set', ...at, key: 'pitLoss.ms.green', value: 24_000 })).toMatchObject({ ok: true });
    const edited = live.store.snapshotOf(ZANDVOORT, 'dry')?.fingerprint;
    expect(edited).toBeDefined();
    expect(edited).not.toBe(start);
    live.push(EDIT_AT + 50, live.total);
    await live.activeMatches({ known: true, value: { setId: 'dry', snapshot: edited, picked: true } });

    // and the decision is in the session file's decisions sidecar, its snapshot in the priors sidecar
    await live.stop();
    const files = readdirSync(live.recordingsDir).filter((name) => name.endsWith('.pwrec.gz'));
    expect(files).toHaveLength(1);
    const file = join(live.recordingsDir, files[0]!);
    expect(JSON.parse(readFileSync(`${file}.decisions.json`, 'utf8'))).toEqual([
      { recordIndex: expect.any(Number), decision: { kind: 'calibrationChosen', setId: 'dry', snapshot: edited } },
    ]);
    const priors = JSON.parse(readFileSync(`${file}.priors.json`, 'utf8')) as { start: string; snapshots: Record<string, unknown> };
    expect(priors.start).toBe(start);
    expect(Object.keys(priors.snapshots).sort()).toEqual([start, edited].sort());
  });

  it('a recompute after a rebuild or at session end commits nothing', async () => {
    const edited = vi.spyOn(FeedPipeline.prototype as FeedPipeline & { calibrationEdited(setId: string): void }, 'calibrationEdited');
    const live = await liveServe();
    live.push(0, EDIT_AT);
    const start = live.store.snapshotOf(ZANDVOORT, 'dry')?.fingerprint;
    await live.activeMatches({ known: true, value: { setId: 'dry', snapshot: start, picked: false } });
    // the recomputes `serve` triggers after a rebuild (C61) and once a session is stored (ruling R14)
    live.store.recompute('rebuild');
    live.store.recompute('sessionEnd');
    live.push(EDIT_AT, live.total);
    await live.activeMatches({ known: true, value: { setId: 'dry', snapshot: start, picked: false } });
    expect(live.active().every((value) => value.known && value.value.snapshot === start && !value.value.picked)).toBe(true);
    // the session ends, is stored and recomputes the store: still no pipeline hears of an edit
    await live.stop();
    expect(edited).not.toHaveBeenCalled();
    const files = readdirSync(live.recordingsDir).filter((name) => name.endsWith('.pwrec.gz'));
    expect(files).toHaveLength(1);
    expect(readdirSync(live.recordingsDir)).not.toContain(`${files[0]!}.decisions.json`);
  });
});
