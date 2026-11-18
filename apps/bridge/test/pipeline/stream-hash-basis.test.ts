// The determinism hash sees the recording's basis sidecar (SP4.3e Task 7a-2 fix round, F1; C38, C54, C62): the same
// recording with its sidecars gives the same topic stream, so `topicStreamHash` runs it on its basis sidecar
// (`recordedBasis: recordingBasis(path, log)`), as a replay does. The hash runs without storage, so the sidecar reaches
// the stream through `basis.active` (its `start`). Copies of one committed segment (C84) that differ only in the sidecar.
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BasisSidecar, SessionRef } from '@pitwall/domain';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { segmentPath } from '../fixtures/replay.ts';

const SEGMENT = segmentPath('race-zandvoort-lap10.pwrec.gz');
const ref = (sessionUid: string): SessionRef => ({ sessionUid, weekendId: '900' }) as SessionRef;

/** A copy of the segment in a directory of its own, with `sidecar` as its basis sidecar (none: `undefined`). */
function copyWith(sidecar: BasisSidecar | undefined): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hash-basis-')), 'race.pwrec.gz');
  copyFileSync(SEGMENT, path);
  if (sidecar !== undefined) writeFileSync(`${path}.basis.json`, JSON.stringify(sidecar));
  return path;
}

const sidecarOf = (sessionUid: string): BasisSidecar => {
  const basis = { practice: [ref(sessionUid)], qualifying: null };
  return { start: basis, preselected: basis };
};

describe('topicStreamHash runs on the basis sidecar (C38)', { timeout: 120_000 }, () => {
  it('the stream hash changes when the basis sidecar changes', async () => {
    const [one, other, none] = await Promise.all([
      topicStreamHash(copyWith(sidecarOf('1')), { features: [] }),
      topicStreamHash(copyWith(sidecarOf('2')), { features: [] }),
      topicStreamHash(copyWith(undefined), { features: [] }),
    ]);
    expect(one).not.toBe(other);
    expect(one).not.toBe(none);
  });

  it('control: the same sidecar gives the same hash', async () => {
    expect(await topicStreamHash(copyWith(sidecarOf('1')), { features: [] })).toBe(await topicStreamHash(copyWith(sidecarOf('1')), { features: [] }));
  });
});
