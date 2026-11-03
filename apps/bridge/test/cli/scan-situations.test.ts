import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OpenSpan, SpanDeclaration } from '@pitwall/domain';
import type { SubMachine } from '@pitwall/engine';
import { carMachine, probeMachine, sessionMachine } from '../../../../packages/engine/test/support/test-machines.ts';
import { segmentPath } from '../../../../test-support/segments.ts';
import type { CliIo } from '../../src/cli/io.ts';

// `pitwall scan-situations [dir]` runs steps 0-2 over every recording of a directory and prints, per sub-machine, each
// transition with its count, the declared transitions never seen and the undeclared ones (exit 1 on those). The command
// reads the registry's `MACHINES`; the tests replace the generated index (as the engine tests do) with test machines.
// Contract assumed for the output: one line per transition `<machine> <from> -> <to> <count>`, one line per declared
// transition never seen `<machine> never seen <from> -> <to>`, one line per undeclared `<machine> undeclared <from> -> <to> <count>`.
const SEGMENTS = ['race-zandvoort-pit-stop.pwrec.gz', 'race-singapore-start.pwrec.gz'];

/** A directory holding the two segments. */
function recordingsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scan-situations-'));
  for (const file of SEGMENTS) copyFileSync(segmentPath(file), join(dir, basename(file)));
  return dir;
}

async function scan(machines: ReadonlyArray<SubMachine<unknown>>, positionals: string[] = [recordingsDir()], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env, signal: new AbortController().signal };
  vi.resetModules();
  vi.doMock('../../../../packages/engine/src/situations/index.generated.ts', () => ({ MACHINES: machines }));
  const { run } = await import('../../src/cli/commands/scan-situations.ts');
  const code = await run(positionals, {}, io);
  return { code, out: out.flatMap((l) => l.split('\n')), err: err.join('\n') };
}

/** The lines of `machine` that mention `text`. */
const lines = (out: string[], machine: string, text: string) => out.filter((l) => l.includes(machine) && l.includes(text));

/**
 * A machine of `scope` (car or zone) with two scopes whose spans alternate `a`/`b` in opposite phase on every frame. Read
 * as one chain (ignoring the scope) its spans give `b -> b` and `a -> a`; read per scope, only `none -> a|b`, `a -> b`
 * and `b -> a`, which it declares.
 */
function alternating(scope: 'car' | 'zone'): SubMachine<{ n: number; opened: number; open: OpenSpan[] }> {
  const id = `alternating-${scope}`;
  const spans: SpanDeclaration = { machine: id, scope, kinds: ['a', 'b'] };
  const at = (index: number) => (scope === 'car' ? { carId: index as never } : { zone: index });
  return {
    id,
    appliesTo: 'all',
    spans,
    inputs: { signals: [], values: [], upstream: [] },
    transitions: [['none', 'a'], ['none', 'b'], ['a', 'b'], ['b', 'a']],
    init: () => ({ n: 0, opened: 0, open: [] }),
    openSpans: (open) => open.open,
    step(open, input) {
      const next: OpenSpan[] = [];
      const closed = [];
      let opened = open.opened;
      for (const index of [0, 1]) {
        const kind = (open.n + index) % 2 === 0 ? 'a' : 'b';
        const was = open.open.find((s) => (scope === 'car' ? s.carId === index : s.zone === index));
        if (was?.kind === kind) next.push(was);
        else {
          if (was) closed.push({ ...was, end: input.at });
          next.push({ machine: id, id: scope === 'car' ? (was?.id ?? -1) + 1 : opened++, ...at(index), kind, start: input.at, confirmed: true, detail: undefined, startFrame: input.frameNumber, ...(was ? {} : { joinedAt: true as const }) });
        }
      }
      return { open: { n: open.n + 1, opened, open: next }, closed };
    },
  };
}

describe('pitwall scan-situations', () => {
  it('zone spans are sequenced per zone: two zones changing alternately give only declared transitions', { timeout: 60_000 }, async () => {
    const r = await scan([alternating('zone')]);
    expect(r.code).toBe(0);
    expect(lines(r.out, 'alternating-zone', 'undeclared')).toEqual([]);
    expect(lines(r.out, 'alternating-zone', 'a -> b')).toContainEqual(expect.stringMatching(/[1-9]\d*\s*$/));
    expect(lines(r.out, 'alternating-zone', 'b -> a')).toContainEqual(expect.stringMatching(/[1-9]\d*\s*$/));
  });

  it('car spans are still sequenced per car', { timeout: 60_000 }, async () => {
    const r = await scan([alternating('car')]);
    expect(r.code).toBe(0);
    expect(lines(r.out, 'alternating-car', 'undeclared')).toEqual([]);
    expect(lines(r.out, 'alternating-car', 'a -> b')).toContainEqual(expect.stringMatching(/[1-9]\d*\s*$/));
  });

  it("prints each sub-machine's transition counts", { timeout: 60_000 }, async () => {
    const r = await scan([sessionMachine, carMachine, probeMachine]);
    expect(r.code).toBe(0);
    expect(lines(r.out, 'test-car', 'none -> track')).toContainEqual(expect.stringMatching(/\d+\s*$/));
    expect(lines(r.out, 'test-car', 'track -> pit')).toContainEqual(expect.stringMatching(/[1-9]\d*\s*$/));
    expect(lines(r.out, 'test-probe', 'seen -> seen')).toContainEqual(expect.stringMatching(/[1-9]\d*\s*$/));
    expect(r.out.join('\n')).not.toContain('[object Object]');
  });

  it('sums the counts over every recording of the directory', { timeout: 60_000 }, async () => {
    const both = await scan([sessionMachine, probeMachine]);
    const single = mkdtempSync(join(tmpdir(), 'scan-situations-one-'));
    copyFileSync(segmentPath(SEGMENTS[0]!), join(single, SEGMENTS[0]!));
    const first = await scan([sessionMachine, probeMachine], [single]);
    const count = (out: string[]) => Number(/(\d+)\s*$/.exec(lines(out, 'test-probe', 'seen -> seen')[0] ?? '')?.[1]);
    expect(count(both.out)).toBeGreaterThan(count(first.out));
  });

  it('a declared transition never seen is listed', { timeout: 60_000 }, async () => {
    const declaresMore: SubMachine<unknown> = { ...carMachine, transitions: [...carMachine.transitions, ['pit', 'pit']] };
    const r = await scan([declaresMore]);
    expect(r.code).toBe(0);
    expect(lines(r.out, 'test-car', 'never seen')).toContainEqual(expect.stringContaining('pit -> pit'));
    expect(lines(r.out, 'test-car', 'never seen').join('\n')).not.toContain('track -> pit');
  });

  it('an undeclared transition is listed and exits 1', { timeout: 60_000 }, async () => {
    const declaresTooLittle: SubMachine<unknown> = { ...carMachine, transitions: carMachine.transitions.filter(([from, to]) => !(from === 'track' && to === 'pit')) };
    const r = await scan([declaresTooLittle, sessionMachine]);
    expect(r.code).toBe(1);
    expect(lines(r.out, 'test-car', 'undeclared')).toContainEqual(expect.stringContaining('track -> pit'));
  });

  it('without a directory it scans PITWALL_FIXTURES_DIR', { timeout: 60_000 }, async () => {
    const r = await scan([sessionMachine, probeMachine], [], { PITWALL_FIXTURES_DIR: recordingsDir() });
    expect(r.code).toBe(0);
    expect(lines(r.out, 'test-probe', 'seen -> seen').length).toBeGreaterThan(0);
  });
});
