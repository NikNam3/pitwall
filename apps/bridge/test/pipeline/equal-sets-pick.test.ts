// SP4.1a f34 (F4, C62a, C76): a priors snapshot is named by its fingerprint, and the run's priors hold its snapshots by
// fingerprint (`RunPriors.snapshots`). Two sets with equal entries are still two snapshots: a pick of the second names
// the second set in `view.priors` and `calibration.active`, not the first one the run started on. The calibration store
// is the real one over a temporary data dir and a fake read of the stored sessions (C84): no user data, no storage.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOPICS, type ServerMessage, type TopicName } from '@pitwall/contracts';
import type { CalibrationActiveValue, CalibrationSetsValue, FeedId, PriorsSnapshot } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { definePriors } from '@pitwall/engine/readers';
import { CalibrationStore } from '../../src/calibration/store.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline, type DecisionResult } from '../../src/pipeline/feed-pipeline.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { HookedSource } from '../helpers/hooked-source.ts';

const F = 'equal-sets' as FeedId;
const ZANDVOORT = 26;
const LAP10 = segmentPath('race-zandvoort-lap10.pwrec.gz');
/** The record of LAP10 (1778 records) after which the run picks the second set. */
const PICK_AFTER = 799;
const log = createLogger({ level: 'silent' });

/** A unit declaring one override-only priors entry: both sets set it to the same value, so their entries are equal. */
const priorsDecl = definePriors('probe', { entries: { 'probe.limitPct': { version: 1, range: [30, 100] } } });

/** A unit that keeps `view.priors` each frame; it reads `view.priors`, so it declares `decisions` (C62a). */
function priorsProbe(): { feature: Feature; seen: Array<EngineView['priors']> } {
  const seen: Array<EngineView['priors']> = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.equal-sets-probe',
    reads: ['feed', 'decisions'],
    cadence: 'frame',
    compute: (view) => {
      seen.push(view.priors);
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'equal-sets-probe', calculators: [calc], topics: [], priors: [priorsDecl] }), seen };
}

describe('a pick of one of two sets with equal entries', () => {
  const probe = priorsProbe();
  const published: Array<{ topic: TopicName; value: unknown }> = [];
  let store: CalibrationStore;
  let a: PriorsSnapshot;
  let b: PriorsSnapshot;
  let answer: DecisionResult | undefined;
  const active: CalibrationActiveValue[] = [];

  beforeAll(async () => {
    store = CalibrationStore.open(mkdtempSync(join(tmpdir(), 'equal-sets-')), {
      features: [probe.feature],
      repo: { sessionsOnTrack: () => [] },
      config: {},
      hub: { publishGlobal: (topic, valueFor) => { published.push({ topic, value: valueFor({}) }); } },
      log,
      rebuild: () => new Promise<void>(() => {}),
    });
    const idOf = (name: string): string => {
      const sets = (published.filter((p) => p.topic === 'calibration.sets').at(-1)?.value as CalibrationSetsValue).sets;
      const set = sets.find((s) => s.name === name);
      if (set === undefined) throw new Error(`no set ${name}`);
      return set.id;
    };
    for (const name of ['A', 'B']) {
      expect(store.apply({ kind: 'calibration.set.create', trackId: ZANDVOORT, name })).toEqual({ ok: true });
      expect(store.apply({ kind: 'calibration.override.set', trackId: ZANDVOORT, setId: idOf(name), key: 'probe.limitPct', value: 80 })).toEqual({ ok: true });
    }
    // The run starts on A (the newest use, spec 3.3).
    store.markUsed(ZANDVOORT, idOf('A'), '2026-11-01T20:00:00.000Z');
    a = store.snapshotOf(ZANDVOORT, idOf('A'))!;
    b = store.snapshotOf(ZANDVOORT, idOf('B'))!;
    expect(b.entries).toEqual(a.entries);

    let nowMs = 0;
    const hub = new TopicHub({ now: () => nowMs });
    hub.addClient('probe', {
      send: (m: ServerMessage) => {
        if ((m.type === 'snapshot' || m.type === 'update') && m.id === 'calibration.active') active.push(m.value as CalibrationActiveValue);
      },
      bufferedAmount: () => 0,
    });
    hub.subscribe({ clientId: 'probe', id: 'calibration.active', topic: 'calibration.active', params: {}, feedId: F });
    expect(TOPICS['calibration.active'].scope).toBe('feed');
    let pipeline: FeedPipeline | undefined = undefined;
    const source = new HookedSource(new PwrecSource({ feedId: F, path: LAP10, mode: 'asFastAsPossible' }), {
      before: (packet) => { nowMs = packet.receivedAtMs; },
      after: (index) => {
        hub.tick();
        if (index === PICK_AFTER) answer = pipeline?.commitDecision(b.setId);
      },
    });
    pipeline = new FeedPipeline({ feedId: F, source, hub, features: [probe.feature], log, calibration: store });
    pipeline.start();
    await pipeline.done;
    hub.tick();
  }, 60_000);

  afterAll(() => store.close());

  it('a pick of the second of two equal sets names the second set', () => {
    expect(answer).toEqual({ ok: true });
    // The run started on A ...
    expect(probe.seen[0]).toMatchObject({ known: true, value: { setId: a.setId, setName: 'A', fingerprint: a.fingerprint } });
    expect(active[0]).toMatchObject({ known: true, value: { setId: a.setId, setName: 'A', snapshot: a.fingerprint, picked: false } });
    // ... and after the pick the units and `calibration.active` see B's snapshot, not A's.
    expect(probe.seen.at(-1)).toMatchObject({ known: true, value: { setId: b.setId, setName: 'B', fingerprint: b.fingerprint } });
    expect(active.at(-1)).toMatchObject({ known: true, value: { setId: b.setId, setName: 'B', snapshot: b.fingerprint, picked: true } });
  });
});
