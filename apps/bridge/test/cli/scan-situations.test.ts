import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SubMachine } from '@pitwall/engine';
import { carMachine, probeMachine, sessionMachine } from '../../../../packages/engine/test/support/test-machines.ts';
import { segmentPath } from '../../../../test-support/segments.ts';
import type { CliIo } from '../../src/cli/io.ts';
import { run } from '../../src/cli/commands/scan-situations.ts';

// `pitwall scan-situations [dir]` runs steps 0-2 over every recording of a directory and prints, per sub-machine, each
// transition with its count, the declared transitions never seen and the undeclared ones (exit 1 on those). The command
// takes the machine list as a fourth parameter (default: the registry's `MACHINES`), so the tests give it test machines.
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
  const code = await run(positionals, {}, io, machines);
  return { code, out: out.flatMap((l) => l.split('\n')), err: err.join('\n') };
}

/** The lines of `machine` that mention `text`. */
const lines = (out: string[], machine: string, text: string) => out.filter((l) => l.includes(machine) && l.includes(text));

describe('pitwall scan-situations', () => {
  it("prints each sub-machine's transition counts", { timeout: 60_000 }, async () => {
    const r = await scan([carMachine, probeMachine]);
    expect(r.code).toBe(0);
    expect(lines(r.out, 'test-car', 'none -> track')).toContainEqual(expect.stringMatching(/\d+\s*$/));
    expect(lines(r.out, 'test-car', 'track -> pit')).toContainEqual(expect.stringMatching(/[1-9]\d*\s*$/));
    expect(lines(r.out, 'test-probe', 'seen -> seen')).toContainEqual(expect.stringMatching(/[1-9]\d*\s*$/));
    expect(r.out.join('\n')).not.toContain('[object Object]');
  });

  it('sums the counts over every recording of the directory', { timeout: 60_000 }, async () => {
    const both = await scan([probeMachine]);
    const single = mkdtempSync(join(tmpdir(), 'scan-situations-one-'));
    copyFileSync(segmentPath(SEGMENTS[0]!), join(single, SEGMENTS[0]!));
    const first = await scan([probeMachine], [single]);
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
    const r = await scan([probeMachine], [], { PITWALL_FIXTURES_DIR: recordingsDir() });
    expect(r.code).toBe(0);
    expect(lines(r.out, 'test-probe', 'seen -> seen').length).toBeGreaterThan(0);
  });
});
