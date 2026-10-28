// `scripts/gen-moments.ts` writes `test-support/moments/<name>.json` (the MomentValues of each named moment).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { captureMoment } from '../../src/moments/capture.ts';
import { readMomentsFile, ROOT, segmentPath } from './helpers.ts';

it('writes one file per named moment, equal to captureMoment of it, and is repeatable', async () => {
  const run = () => execFileSync('node', ['scripts/gen-moments.ts'], { cwd: ROOT, encoding: 'utf8' });
  run();
  const read = (name: string) => readFileSync(join(ROOT, 'test-support/moments', `${name}.json`), 'utf8');
  const moments = readMomentsFile();
  const first = Object.fromEntries(Object.keys(moments).map((name) => [name, read(name)]));
  run();
  for (const [name, { segment, atMs }] of Object.entries(moments)) {
    expect(read(name)).toBe(first[name]);
    expect(JSON.parse(first[name]!)).toEqual(JSON.parse(JSON.stringify(await captureMoment(segmentPath(segment), atMs))));
  }
}, 300_000);
