import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli/pitwall.ts';
import type { CliIo } from '../../src/cli/io.ts';

// `pitwall where <unit>` and `pitwall where --topic <name>` read a catalogue file, one line per folder, file or link.
// Contract assumed: `--catalogue <file>` names the file (default: `catalogue.generated.json` at the repo root),
// so the tests do not depend on `pnpm gen` or on the real widgets.
const CATALOGUE = join(import.meta.dirname, '..', 'fixtures', 'catalogue.json');

async function where(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, signal: new AbortController().signal };
  const code = await main(['where', ...args], io);
  return { code, out: out.flatMap((l) => l.split('\n')), err: err.join('\n') };
}

describe('pitwall where <unit>', () => {
  it('prints the widget folder, the feature folder, the topic file and the binding of feed-status', async () => {
    const r = await where(['feed-status', '--catalogue', CATALOGUE]);
    expect(r.code).toBe(0);
    expect(r.out).toContainEqual(expect.stringContaining('apps/ui/src/widgets/feed-status'));
    expect(r.out).toContainEqual(expect.stringContaining('apps/bridge/src/features/feed-status'));
    expect(r.out).toContainEqual(expect.stringContaining('packages/contracts/src/topics/feed.status.ts'));
    expect(r.out).toContainEqual(expect.stringMatching(/feed\.status.*calculator|calculator.*feed\.status/));
  });

  it('prints cadences and reads as readable strings, never [object Object]', async () => {
    const r = await where(['feed-status', '--catalogue', CATALOGUE]);
    expect(r.out.join('\n')).not.toContain('[object Object]');
    expect(r.out).toContainEqual(expect.stringContaining('10 Hz'));
    expect(r.out).toContainEqual(expect.stringContaining('calculator:feed.status'));
  });

  it('an unknown unit names itself, exits 1', async () => {
    const r = await where(['nope', '--catalogue', CATALOGUE]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('nope');
  });

  it('without a unit or --topic: usage error, exit 1', async () => {
    expect((await where(['--catalogue', CATALOGUE])).code).toBe(1);
  });

  it('a missing catalogue file tells to run pnpm gen, exit 1', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'where-')), 'catalogue.generated.json');
    const r = await where(['feed-status', '--catalogue', missing]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('pnpm gen');
  });

  it('a file that is not JSON: exit 1, not a crash', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'where-')), 'c.json');
    writeFileSync(file, 'not json');
    const r = await where(['feed-status', '--catalogue', file]);
    expect(r.code).toBe(1);
    expect(r.err).not.toContain('a bug');
  });
});

describe('pitwall where --topic <name>', () => {
  it('prints who binds the topic, who reads it and its file', async () => {
    const r = await where(['--topic', 'feed.status', '--catalogue', CATALOGUE]);
    expect(r.code).toBe(0);
    expect(r.out).toContainEqual(expect.stringContaining('packages/contracts/src/topics/feed.status.ts'));
    expect(r.out).toContainEqual(expect.stringContaining('apps/bridge/src/features/feed-status'));
    expect(r.out).toContainEqual(expect.stringContaining('apps/ui/src/widgets/feed-status'));
  });

  it('an unknown topic names itself, exits 1', async () => {
    const r = await where(['--topic', 'nope.rows', '--catalogue', CATALOGUE]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('nope.rows');
  });
});
