// C49 (jobs always): `serve` builds every feed it serves to the UI (`pitwall live`, `replay`, `dev --replay`) with
// `servesUi: true`, so its jobs run all session; a pipeline that serves no UI (`pitwall reprocess`, the rebuild, a
// score run) leaves it unset and keeps its jobs on demand.
//
// The options each `FeedPipeline` is built with are captured by a subclass that stands in for it; the pipelines are
// the real ones. Temporary dirs only, no storage (C84); the replay is of a committed segment.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { recordingHub, recordingPipeline } from '../../src/cli/process-recording.ts';
import { serve, type ServeOptions } from '../../src/cli/serve.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { createLogger } from '../../src/log.ts';
import type * as pipelineModule from '../../src/pipeline/feed-pipeline.ts';
import type { FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { ManualSource } from '../helpers/manual-source.ts';

/** The options of every `FeedPipeline` built since the last reset, in order. */
const built: FeedPipelineOptions[] = [];

vi.mock('../../src/pipeline/feed-pipeline.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof pipelineModule>();
  class CapturingPipeline extends mod.FeedPipeline {
    constructor(opts: FeedPipelineOptions) {
      built.push(opts);
      super(opts);
    }
  }
  return { ...mod, FeedPipeline: CapturingPipeline };
});

const tmp = () => mkdtempSync(join(tmpdir(), 'serve-serves-ui-'));

const cleanup: Array<() => unknown> = [];
beforeEach(() => {
  built.length = 0;
});
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

type Io = ServeOptions['io'];

/** Runs `serve` with `opts(io)` until it listens; stops it at the test's end. */
async function serving(opts: (io: Io) => ServeOptions): Promise<void> {
  const out: string[] = [];
  const abort = new AbortController();
  const done = serve(opts({ out: (line: string) => out.push(line), err: () => {}, env: {}, signal: abort.signal }));
  cleanup.push(async () => {
    abort.abort();
    await done;
  });
  await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 60_000 });
}

describe('serve builds its pipelines with servesUi (C49)', { timeout: 120_000 }, () => {
  it('pitwall live: every live feed\'s pipeline serves the UI', async () => {
    const a = new ManualSource('udp-20777' as FeedId);
    const b = new ManualSource('udp-20778' as FeedId);
    await serving((io) => ({
      sources: [
        { source: a, port: 20_777, feed: { kind: 'udp', label: 'UDP port 20777' } },
        { source: b, port: 20_778, feed: { kind: 'udp', label: 'UDP port 20778' } },
      ],
      wsPort: 0,
      dumpsDir: join(tmp(), 'dumps'),
      io,
    }));
    expect(built.map((o) => [o.feedId, o.servesUi])).toEqual([
      ['udp-20777', true],
      ['udp-20778', true],
    ]);
  });

  it('pitwall replay: the replayed feed\'s pipeline serves the UI', async () => {
    const feedId = 'replay' as FeedId;
    await serving((io) => ({
      replay: { feedId, path: segmentPath('practice-wing-change.pwrec.gz'), controls: [], unpaced: true },
      feed: { kind: 'replay', label: 'practice-wing-change' },
      wsPort: 0,
      dumpsDir: join(tmp(), 'dumps'),
      io,
    }));
    expect(built.length).toBeGreaterThan(0);
    for (const o of built) expect(o.servesUi).toBe(true);
  });

  it('a recording run (reprocess, rebuild) serves no UI: servesUi is left unset', () => {
    const path = segmentPath('practice-wing-change.pwrec.gz');
    let pipeline: ReturnType<typeof recordingPipeline> | undefined = undefined;
    pipeline = recordingPipeline({ path, hub: recordingHub(() => pipeline), log: createLogger({ level: 'silent' }), config: effectiveConfig(FEATURES) });
    expect(built).toHaveLength(1);
    expect(built[0]!.servesUi).toBeUndefined();
  });
});
