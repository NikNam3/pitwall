import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { OpenSpan } from '@pitwall/domain';
import type { SubMachine } from '@pitwall/engine';
import { carMachine, probeMachine, sessionMachine } from '../../../../packages/engine/test/support/test-machines.ts';
import { segmentPath } from '../../../../test-support/segments.ts';
import type { CliIo } from '../../src/cli/io.ts';

// `pitwall scan-situations [dir]` runs steps 0-2 over every recording of a directory and prints, per sub-machine, each
// transition with its count, the declared transitions never seen and the undeclared ones (exit 1 on those). The command
// reads the registry's `MACHINES`; the tests replace the generated index (as the engine tests do) with test machines.
// Contract assumed for the output: one line per transition `<machine> <from> -> <to> <count>`, one line per declared
// transition never seen `<machine> never seen <from> -> <to>`, one line per undeclared `<machine> undeclared <from> -> <to> <count>`,
// and, apart from the transitions, one line per machine and kind of the spans the session's end closes
// (`closeSession`) `<machine> closed at session end <kind> <count>`. Step 0's clock is scanned with the sub-machines
// (brief Task 9, ruling 12). A span a sub-machine closes with no successor opening on its frame is `<kind> -> none`.
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

describe('pitwall scan-situations', () => {
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
  it('also scans step 0’s clock: its transitions are printed as a sub-machine’s', { timeout: 60_000 }, async () => {
    const r = await scan([sessionMachine]);
    expect(r.code).toBe(0);
    expect(lines(r.out, 'clock', 'none -> running')).toContainEqual(expect.stringMatching(/^clock none -> running [1-9]\d*\s*$/));
  });

  it('prints the spans the session’s end closes apart, per machine and kind, as closed at session end: they are no transition', { timeout: 60_000 }, async () => {
    const r = await scan([sessionMachine]);
    expect(r.code).toBe(0);
    // each of the two recordings ends with test-session's `green` and the clock's `running` open
    expect(lines(r.out, 'test-session', 'closed at session end')).toEqual(['test-session closed at session end green 2']);
    expect(lines(r.out, 'clock', 'closed at session end')).toEqual(['clock closed at session end running 2']);
    expect(r.out.filter((l) => l.includes('-> none'))).toEqual([]);
  });

  it('a span a sub-machine closes with no successor on its frame is the transition <kind> -> none: undeclared, it exits 1', { timeout: 60_000 }, async () => {
    type Gap = { frames: number; open?: OpenSpan };
    // `on` from the session's first frame; on the tenth it closes and nothing follows it.
    const gapMachine: SubMachine<Gap> = {
      id: 'test-gap',
      appliesTo: 'all',
      spans: { machine: 'test-gap', scope: 'session', kinds: ['on'] },
      inputs: { signals: [], values: [], upstream: [] },
      transitions: [['none', 'on']],
      init: () => ({ frames: 0 }),
      openSpans: (open) => (open.open ? [open.open] : []),
      step(open, input) {
        const frames = open.frames + 1;
        if (frames === 1) {
          return { open: { frames, open: { machine: 'test-gap', id: 0, kind: 'on', start: input.at, confirmed: true, joinedAt: true, detail: undefined, startFrame: input.frameNumber } }, closed: [] };
        }
        if (frames === 10 && open.open) return { open: { frames }, closed: [{ ...open.open, end: input.at }] };
        return { open: { ...open, frames }, closed: [] };
      },
    };
    const r = await scan([gapMachine as SubMachine<unknown>, sessionMachine]);
    expect(r.code).toBe(1);
    expect(lines(r.out, 'test-gap', 'undeclared')).toEqual(['test-gap undeclared on -> none 2']);
    expect(lines(r.out, 'test-gap', 'closed at session end')).toEqual([]);
  });
});
