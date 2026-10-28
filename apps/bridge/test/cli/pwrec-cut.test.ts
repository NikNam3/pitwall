import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { main } from '../../src/cli/pwrec-cut.ts';
import { drain } from '../pwrec/helpers.ts';

const SEG = join(import.meta.dirname, '../../../../fixtures/segments');
const CLI = join(import.meta.dirname, '../../src/cli/pwrec-cut.ts');
const tmp = () => mkdtempSync(join(tmpdir(), 'pwrec-cut-'));
async function run(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const USAGE = 'usage: pwrec-cut <in.pwrec.gz> <out.pwrec.gz> --from <sessionTimeS> --to <sessionTimeS>';

describe('pwrec-cut CLI', () => {
  it('rejects bad arguments with usage and exit 1', async () => {
    expect(await run([])).toMatchObject({ code: 1, err: expect.stringContaining(USAGE) });
    expect(await run(['a', 'b', '--from', 'x', '--to', '2'])).toMatchObject({ code: 1, err: expect.stringContaining(USAGE) });
    expect(await run(['a', 'b', '--from', '5', '--to', '2'])).toMatchObject({ code: 1, err: expect.stringContaining('pwrec-cut: --from 5 is after --to 2') });
  });
  it('refuses to overwrite and reports an empty window', async () => {
    const out = join(tmp(), 'o.pwrec.gz'); writeFileSync(out, '');
    expect(await run([join(SEG, 'race-singapore-end.pwrec.gz'), out, '--from', '61.5', '--to', '62'])).toMatchObject({ code: 1, err: expect.stringContaining('already exists') });
    expect(await run([join(SEG, 'race-singapore-end.pwrec.gz'), join(tmp(), 'e.pwrec.gz'), '--from', '100', '--to', '200']))
      .toMatchObject({ code: 1, err: 'pwrec-cut: no records with sessionTime in [100, 200] s' });
  });
  it('cuts a segment of a segment with a clean end marker', async () => {
    const out = join(tmp(), 'sub.pwrec.gz');
    const r = await run([join(SEG, 'race-singapore-end.pwrec.gz'), out, '--from', '62', '--to', '62.5']);
    expect(r.code).toBe(0); expect(r.out).toMatch(/^wrote .*sub\.pwrec\.gz: \d+ records \(2 context\), [\d.]+ ms$/);
    const { records, summary } = await drain(out);
    expect(records[0]!.t).toBe(0); expect(summary.endedCleanly).toBe(true); expect(summary.durationMs).toBe(records.at(-1)!.t);
  });
  it('runs as a script', () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    expect(r.status).toBe(1); expect(r.stderr).toContain(USAGE);
  });
});

const SEGMENTS = [
  ['ttZandvoort', 'tt-zandvoort-lap1.pwrec.gz', '112', '118'],
  ['raceSingapore', 'race-singapore-start.pwrec.gz', '0', '0.5'],
  ['raceSingapore', 'race-singapore-end.pwrec.gz', '61.5', '63.4'],
] as const;
for (const [fixture, file, from, to] of SEGMENTS) {
  describeWithFixture(fixture, `re-cutting ${file}`, (path) => {
    it('reproduces the committed segment record for record', async () => {
      const out = join(tmp(), file);
      expect((await run([path, out, '--from', from, '--to', to])).code).toBe(0);
      expect(await drain(out)).toEqual(await drain(join(SEG, file)));
    }, 120_000);
  });
}
