// A basis from a recording (SP4.3e Task 7a-2 fix round, F1 and F2; C38, C61, C62; spec §4.2).
//
// - F1: `pitwall reprocess` runs a recording through `recordingPipeline` (`processRecording`'s pipeline): with the
//   recording's basis sidecar (`recordedBasis: recordingBasis(path, log)`), its sessions start on the sidecar's `start`,
//   not on the seat's earlier sessions of the weekend (the rule for a recording without one). The live race here is in a
//   lobby of its own whose last choice names a practice of an earlier weekend: its `start` is that practice, while the
//   weekend's earlier sessions are none.
// - F2: a replay or reprocess after a rules-version change (C90) makes the sessions its sidecar's `start` names, and those
//   of every recorded `basisChosen`, current before its first frame (`ensureCurrent`, priority `firstRead`) and waits for
//   them (C61), so it runs on the sessions the live run had (C38). Seam: `./basis-support.ts` (`replayWithRebuild`).
import { describe, expect, it } from 'vitest';
import { feedId, NO_BASIS, type TrackId } from '@pitwall/domain';
import { recordingPipeline } from '../../src/cli/process-recording.ts';
import { effectiveConfig } from '../../src/feature-config.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import type { LastChoice } from '../../src/pipeline/last-choice-types.ts';
import {
  A, AT, basisPerFrame, basisProbe, basisSidecarOf, bridge, builder, chosen, fakeRebuild, keyOf, last, log, markStale, RACE_UID, RULES,
  replayWithRebuild, SESSION_TYPE, settle, slice, storeSession, TRACK, type Seen,
} from './basis-support.ts';

const EARLIER = 70;
const LOBBY = 71;
const WEEKEND = 72;

/** `file` reprocessed as `pitwall reprocess` runs it (`recordingPipeline`), storing into `db`: what the probe saw. */
async function reprocessed(db: Parameters<typeof storeSession>[0], file: string): Promise<Seen[]> {
  const probe = basisProbe();
  const features = [probe.feature];
  const pipeline = recordingPipeline({
    path: file,
    hub: new TopicHub({ now: () => 0 }),
    log,
    config: effectiveConfig(features),
    features,
    storage: { db, rulesVersion: RULES, mode: 'replace', sourcePath: file },
  });
  pipeline.start();
  await pipeline.done;
  return probe.seen;
}

describe('a recording with a basis sidecar is reprocessed on it (F1, C38, C62)', () => {
  it('reprocessing a recording with a basis sidecar (recordingPipeline, as pitwall reprocess runs it) gives the same view.basis at every frame as the live run', async () => {
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 80n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const at = new Date(AT.practice).toISOString();
    const choice: LastChoice = {
      trackId: TRACK as TrackId,
      basis: { practice: { refs: [practice], at }, qualifying: { ref: null, at } },
      plan: { id: null, at },
    };
    b.lastChoice.read.mockReturnValue(choice);
    const start = { practice: [practice], qualifying: null };

    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(20, () => {}).packets();
    a.push(slice(packets, 0, 20));
    const file = await a.end();
    // the live run started on the last choice's practice, which is not of the race's weekend
    expect(basisSidecarOf(file)).toEqual({ start, preselected: start });
    expect(last(a.seen)).toMatchObject({ basis: start, sessions: ['80/0'] });

    const seen = await reprocessed(b.db, file);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!.basis).not.toEqual(NO_BASIS);
    expect(basisPerFrame(seen)).toEqual(basisPerFrame(a.seen));
  });
});

describe('a replay after a rules-version change makes its recorded basis current first (F2, C38, C61, C62)', () => {
  it("a replay after a rules-version change waits before its first frame for its start's sessions (ensureCurrent, firstRead) and runs on the same sessions as the live run", async () => {
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 81n, weekend: WEEKEND, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const qualifying = await storeSession(b.db, { uid: 82n, weekend: WEEKEND, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
    const start = { practice: [practice], qualifying };

    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: WEEKEND, type: SESSION_TYPE.race, player: 0 }).frames(20, () => {}).packets();
    a.push(slice(packets, 0, 20));
    const file = await a.end();
    expect(basisSidecarOf(file)).toEqual({ start, preselected: start });
    expect(last(a.seen).sessions).toEqual(['81/0', '82/0']);

    // the bridge's rules version changed since (C90): both sessions are stale; the qualifying's rebuild is held
    const keys = [keyOf(practice, 0), keyOf(qualifying, 0)];
    for (const k of keys) markStale(b.db, k);
    const rebuild = fakeRebuild(b.db);
    rebuild.hold(keys[1]!);
    const replay = await replayWithRebuild(b.db, file, feedId('replay'), rebuild.service);
    await settle();
    // no frame is applied while the start's sessions are made current: the replay waits at its first read (C61)
    expect(replay.seen).toEqual([]);
    const asked = rebuild.calls.filter((c) => c.priority === 'firstRead' || c.priority === undefined).flatMap((c) => c.refs);
    expect(asked).toEqual(expect.arrayContaining(keys));
    // a replay is no running session: it never asks at the running basis's priority
    expect(rebuild.calls.filter((c) => c.priority === 'runningBasis')).toEqual([]);

    rebuild.release(keys[1]!);
    await replay.done;
    expect(basisPerFrame(replay.seen)).toEqual(basisPerFrame(a.seen));
    expect(last(replay.seen).decisions).toEqual(last(a.seen).decisions);
  });

  it('a replay after a rules-version change makes the sessions of a recorded basisChosen current before its first frame and runs on the same sessions as the live run', async () => {
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 83n, weekend: EARLIER, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const basis = { practice: [practice], qualifying: null };

    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: LOBBY, type: SESSION_TYPE.race, player: 0 }).frames(20, () => {}).packets();
    a.push(slice(packets, 0, 8));
    const routing = await b.routing();
    expect(await routing.choose({ kind: 'basis.choose', feedId: A, basis, plan: undefined })).toEqual({ ok: true });
    await settle();
    a.push(slice(packets, 8, 20));
    const file = await a.end();
    // the session started on no basis; the choice entered by decision
    expect(basisSidecarOf(file)).toEqual({ start: NO_BASIS, preselected: NO_BASIS });
    expect(chosen(last(a.seen))).toHaveLength(1);
    expect(last(a.seen)).toMatchObject({ basis, sessions: ['83/0'] });

    const key = keyOf(practice, 0);
    markStale(b.db, key);
    const rebuild = fakeRebuild(b.db);
    rebuild.hold(key);
    const replay = await replayWithRebuild(b.db, file, feedId('replay'), rebuild.service);
    await settle();
    expect(replay.seen).toEqual([]);
    const asked = rebuild.calls.filter((c) => c.priority === 'firstRead' || c.priority === undefined).flatMap((c) => c.refs);
    expect(asked).toContainEqual(key);

    rebuild.release(key);
    await replay.done;
    expect(basisPerFrame(replay.seen)).toEqual(basisPerFrame(a.seen));
    expect(last(replay.seen)).toMatchObject({ basis, sessions: ['83/0'] });
  });
});
