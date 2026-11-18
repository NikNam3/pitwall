// A moment is captured on the segment's basis sidecar (SP4.3e Task 7a-2 fix round, F1; C38, C54, C62): `captureMoment`
// runs the segment with its sidecars as a replay does (`recordedBasis: recordingBasis(path, log)`), so `basis.active`
// holds the sidecar's `start`. The capture stores nothing, so no session of the basis is loaded; the topic shows the
// sidecar's start as it is. A copy of one committed segment (C84) with a basis sidecar the test writes.
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BasisSidecar, SessionRef } from '@pitwall/domain';
import { captureMoment } from '../../src/moments/capture.ts';
import { segmentPath } from './helpers.ts';

const LAP10 = 'race-zandvoort-lap10.pwrec.gz';
const START = { practice: [{ sessionUid: '11', weekendId: '900' } as SessionRef], qualifying: { sessionUid: '12', weekendId: '900' } as SessionRef };
const PRESELECTED = { practice: [...START.practice, { sessionUid: '10', weekendId: '900' } as SessionRef], qualifying: START.qualifying };

describe('captureMoment runs on the basis sidecar (C38)', () => {
  it("a segment with a basis sidecar captures basis.active with the sidecar's start", async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'moment-basis-')), LAP10);
    copyFileSync(segmentPath(LAP10), path);
    const sidecar: BasisSidecar = { start: START, preselected: PRESELECTED };
    writeFileSync(`${path}.basis.json`, JSON.stringify(sidecar));

    const values = await captureMoment(path, 3000);
    const active = values.find((v) => v.topic === 'basis.active')?.value as { basis: unknown; start: unknown } | undefined;
    expect(active).toBeDefined();
    expect(active!.start).toEqual(START);
    expect(active!.basis).toEqual(START);
  }, 60_000);
});
