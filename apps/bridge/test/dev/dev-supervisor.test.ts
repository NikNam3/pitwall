// `DevSupervisor` (Task 7, spec 8.4): watches source dirs and restarts the replay child at the same moment.
// Assumed shapes (the implementation must export / accept these):
//   type PositionMessage = { type: 'position'; sessionTimeMs: number; paused: boolean; speed: number };
//   interface ChildHandle { onMessage(cb: (msg: unknown) => void): void; onExit(cb: (code: number | null) => void): void; kill(signal: 'SIGTERM' | 'SIGKILL'): void }
//   type SpawnChild = (args: string[]) => ChildHandle;   // args are the pitwall CLI args: ['replay', file, '--dev', ...]
//   opts additionally accept the optional `gen?: () => Promise<void> | void` (what runs `pnpm gen` before each restart).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevSupervisor } from '../../src/dev/dev-supervisor.ts';

class FakeChild {
  killed: string[] = [];
  private msg: Array<(m: unknown) => void> = [];
  private exit: Array<(c: number | null) => void> = [];
  readonly args: string[];
  private readonly onKill: (c: FakeChild, s: string) => void;
  constructor(args: string[], onKill: (c: FakeChild, s: string) => void) { this.args = args; this.onKill = onKill; }
  onMessage(cb: (m: unknown) => void) { this.msg.push(cb); }
  onExit(cb: (c: number | null) => void) { this.exit.push(cb); }
  kill(signal: 'SIGTERM' | 'SIGKILL') { this.killed.push(signal); this.onKill(this, signal); }
  position(sessionTimeMs: number, paused = false, speed = 1) { for (const cb of this.msg) cb({ type: 'position', sessionTimeMs, paused, speed }); }
  exitWith(code: number | null) { for (const cb of this.exit) cb(code); }
}

const DEBOUNCE = 150;
let dir: string;
let children: FakeChild[];
let gens: number;
let sup: DevSupervisor | undefined;
let stderr: ReturnType<typeof vi.spyOn>;

const make = (extra: { firstArgs?: string[] } = {}) => {
  sup = new DevSupervisor({
    ...extra,
    file: 'race.pwrec.gz',
    watch: [dir],
    debounceMs: DEBOUNCE,
    gen: () => { gens++; },
    // A well-behaved child: exits as soon as it is told to stop.
    spawn: (args: string[]) => { const c = new FakeChild(args, (child) => queueMicrotask(() => child.exitWith(null))); children.push(c); return c; },
  } as ConstructorParameters<typeof DevSupervisor>[0]);
  sup.start();
  return sup;
};
const touch = (name: string, text = String(Math.random())) => { mkdirSync(join(dir, 'sub'), { recursive: true }); writeFileSync(join(dir, name), text); };
const stderrLines = () => (stderr.mock.calls as unknown[][]).map((c) => String(c[0])).filter((s: string) => s.trim() !== '');
const settle = (ms = DEBOUNCE * 3) => new Promise((r) => setTimeout(r, ms));
const arg = (c: FakeChild, flag: string) => c.args[c.args.indexOf(flag) + 1];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pitwall-dev-'));
  children = []; gens = 0;
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(async () => { await sup?.stop(); sup = undefined; stderr.mockRestore(); rmSync(dir, { recursive: true, force: true }); });

describe('DevSupervisor', () => {
  it('start spawns one child: pitwall replay <file> --dev, with no --at-time before any position is known', () => {
    make();
    expect(children).toHaveLength(1);
    expect(children[0]!.args.slice(0, 3)).toEqual(['replay', 'race.pwrec.gz', '--dev']);
    expect(children[0]!.args).not.toContain('--at-time');
  });

  it('one change restarts once: old child gets SIGTERM, pnpm gen runs, the new child resumes --at-time at the last reported position, same speed, playing', async () => {
    make();
    children[0]!.position(1000, false, 2);
    children[0]!.position(61_500, false, 2);
    touch('sub/a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(children[0]!.killed[0]).toBe('SIGTERM');
    expect(gens).toBe(1);
    expect(children[1]!.args.slice(0, 3)).toEqual(['replay', 'race.pwrec.gz', '--dev']);
    expect(arg(children[1]!, '--at-time')).toBe('61500');
    expect(arg(children[1]!, '--speed')).toBe('2');
    expect(children[1]!.args).not.toContain('--paused');
    await settle();
    expect(children).toHaveLength(2);
  });

  it('a paused child comes back --paused at its position', async () => {
    make();
    children[0]!.position(90_000, true, 1);
    touch('b.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(arg(children[1]!, '--at-time')).toBe('90000');
    expect(children[1]!.args).toContain('--paused');
  });

  it('the restarted child is tracked too: a second change resumes from the new child\'s position', async () => {
    make();
    children[0]!.position(10_000);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1]!.position(20_000, true, 4);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(3));
    expect(arg(children[2]!, '--at-time')).toBe('20000');
    expect(arg(children[2]!, '--speed')).toBe('4');
    expect(children[2]!.args).toContain('--paused');
  });

  it('three changes within the debounce window restart once', async () => {
    make();
    children[0]!.position(5000);
    touch('a.ts', '1'); touch('b.ts', '1'); touch('sub/c.ts', '1');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    await settle();
    expect(children).toHaveLength(2);
    expect(gens).toBe(1);
    expect(children[0]!.killed).toEqual(['SIGTERM']);
  });

  it('a change in a nested directory is seen (recursive watch)', async () => {
    make();
    touch('sub/deep.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
  });

  it('*.generated.ts changes are ignored', async () => {
    make();
    children[0]!.position(5000);
    touch('index.generated.ts'); touch('sub/other.generated.ts');
    await settle();
    expect(children).toHaveLength(1);
    expect(children[0]!.killed).toEqual([]);
    expect(gens).toBe(0);
  });

  it('a child that exits 1 before its first position is reported once on stderr and not respawned until the next change', async () => {
    make();
    children[0]!.position(33_000);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1]!.exitWith(1); // a syntax error: dies before any position
    await settle();
    expect(children).toHaveLength(2);
    expect(stderrLines()).toHaveLength(1);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(3));
    expect(arg(children[2]!, '--at-time')).toBe('33000'); // the failed child never reported, so the last known moment stands
    expect(stderrLines()).toHaveLength(1);
  });

  it('a first child that exits 1 before any position is also reported once and not respawned', async () => {
    make();
    children[0]!.exitWith(1);
    await settle();
    expect(children).toHaveLength(1);
    expect(stderrLines()).toHaveLength(1);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
  });

  it('stop kills the child with SIGTERM, resolves, and later changes spawn nothing', async () => {
    make();
    await sup!.stop();
    expect(children[0]!.killed[0]).toBe('SIGTERM');
    touch('a.ts');
    await settle();
    expect(children).toHaveLength(1);
  });

  // Final fix wave (A-I2): dev children play paced, restarts keep the original jump, --speed only when it is not 1.
  const paced = (c: FakeChild) => c.args.includes('--realtime') || c.args.includes('--speed');

  it('every child is paced: --realtime (or an explicit --speed), never the unpaced default', async () => {
    make({ firstArgs: ['--at-lap', '5'] });
    expect(paced(children[0]!)).toBe(true);
    children[0]!.position(10_000, false, 1);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(paced(children[1]!)).toBe(true);
  });

  it('a restart at speed 1 passes no --speed; at another speed it passes --speed', async () => {
    make();
    children[0]!.position(10_000, false, 1);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(children[1]!.args).not.toContain('--speed');
    children[1]!.position(20_000, false, 2);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(3));
    expect(arg(children[2]!, '--speed')).toBe('2');
  });

  it('the first child gets firstArgs; a restart before any position keeps --at-lap', async () => {
    make({ firstArgs: ['--at-lap', '5'] });
    expect(arg(children[0]!, '--at-lap')).toBe('5');
    touch('a.ts'); // saved during the startup jump: no position has been reported yet
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(arg(children[1]!, '--at-lap')).toBe('5');
    expect(children[1]!.args).not.toContain('--at-time');
  });

  it('a restart before any position keeps --at-time too; once a position is known it wins over firstArgs', async () => {
    make({ firstArgs: ['--at-time', '61000'] });
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(arg(children[1]!, '--at-time')).toBe('61000');
    children[1]!.position(70_000, false, 1);
    touch('a.ts');
    await vi.waitFor(() => expect(children).toHaveLength(3));
    expect(arg(children[2]!, '--at-time')).toBe('70000');
    expect(children[2]!.args).not.toContain('--at-lap');
  });
});
