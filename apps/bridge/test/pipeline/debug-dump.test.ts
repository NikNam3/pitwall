import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { ScenarioBuilder } from '../../../../packages/engine/test/builders/index.ts';
import { MAX_DUMPS_PER_SESSION, writeDebugDump } from '../../src/pipeline/debug-dump.ts';

const F = 'test' as FeedId;
const frame = new ScenarioBuilder({ sessionUid: 1895827638050388100n, cars: 2 }).session().participants().frames(3, () => {}).build()[2]!;
const dir = () => mkdtempSync(join(tmpdir(), 'dump-'));

describe('writeDebugDump', () => {
  it('writes <feedId>-<sessionUid>-<frameId>.json and returns where', () => {
    const d = dir();
    const written = writeDebugDump(d, { feedId: F, sessionUid: frame.sessionUid, frame, pwrec: { path: '/rec/a.pwrec.gz', t: 1234 }, error: new Error('select failed') });
    expect(basename(written)).toBe(`test-1895827638050388100-${frame.frameId}.json`);
    expect(readdirSync(d)).toEqual([basename(written)]);
  });
  it('writes bigints as decimal strings and keeps the pwrec position and the error text', () => {
    const d = dir();
    const written = writeDebugDump(d, { feedId: F, sessionUid: frame.sessionUid, frame, pwrec: { path: '/rec/a.pwrec.gz', t: 1234 }, error: new Error('select failed') });
    const dump = JSON.parse(readFileSync(join(d, basename(written)), 'utf8'));
    expect(dump).toMatchObject({ feedId: F, sessionUid: '1895827638050388100', frame: { sessionUid: '1895827638050388100', frameId: frame.frameId }, pwrec: { path: '/rec/a.pwrec.gz', t: 1234 } });
    expect(dump.frame.session.header.sessionUid).toBe('1895827638050388100');
    expect(JSON.stringify(dump.error)).toContain('select failed');
  });
  it('without a session file the pwrec position has no path', () => {
    const d = dir();
    const written = writeDebugDump(d, { feedId: F, sessionUid: frame.sessionUid, frame, pwrec: { t: 48 }, error: 'plain text' });
    const dump = JSON.parse(readFileSync(join(d, basename(written)), 'utf8'));
    expect(dump.pwrec).toEqual({ t: 48 });
    expect(JSON.stringify(dump.error)).toContain('plain text');
  });
  it('allows 20 dumps per session', () => {
    expect(MAX_DUMPS_PER_SESSION).toBe(20);
  });
});
