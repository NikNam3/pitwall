// `pitwall replay <file> [--paused] [--speed <n>] [--at-lap <n> | --at-time <ms>]` (Task 5, requirement 5).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli, SEGMENT, startCli } from '../helpers/cli.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-cli-rt-'));
const env = () => ({ PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: tmp() });

/** Starts a replay, taps replay.status once it prints `listening`, and returns its first value. */
async function firstStatus(args: string[]) {
  const replay = startCli(['replay', SEGMENT, ...args], env());
  const [, port] = (await replay.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/))!;
  const tap = startCli(['tap', 'replay.status', '--url', `ws://127.0.0.1:${port}`], {});
  const [, json] = (await tap.waitFor(/"type":"(?:snapshot|update)".*?"value":(\{[^\n]*\})\}/))!;
  await tap.stop(); await replay.stop();
  return JSON.parse(json!) as { paused: boolean; speed: number; sessionTimeMs: number; playerLap: number; atEnd: boolean; note?: string };
}

describe('pitwall replay transport flags', { timeout: 30_000 }, () => {
  it('--paused starts paused, at the start, with the position of the first frame (never sessionTimeMs 0 before one)', async () => {
    const status = await firstStatus(['--paused']);
    expect(status).toMatchObject({ paused: true, speed: 1, atEnd: false });
    expect(status.sessionTimeMs).toBeGreaterThan(0);
  });
  it('--speed sets the speed', async () => {
    expect(await firstStatus(['--paused', '--speed', '2'])).toMatchObject({ paused: true, speed: 2 });
  });
  it('--at-time has jumped before listening is printed, and --paused keeps it there', async () => {
    // The segment is a mid-session cut, about 112015 to 117993 ms: 115000 lies inside it, so only a real jump reaches it.
    const status = await firstStatus(['--paused', '--at-time', '115000']);
    expect(status.sessionTimeMs).toBeGreaterThanOrEqual(115_000);
    expect(status.sessionTimeMs).toBeLessThan(117_900);
    expect(status).toMatchObject({ paused: true, atEnd: false });
  });
  it('prints "replay finished" once for a real end, and not before listening when a startup jump lands at the end', async () => {
    const jumped = startCli(['replay', SEGMENT, '--paused', '--at-lap', '99'], env());
    await jumped.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/);
    expect(jumped.stderr()).not.toContain('replay finished');
    await new Promise((r) => setTimeout(r, 500));
    expect((jumped.stderr().match(/replay finished/g) ?? []).length).toBeLessThanOrEqual(1);
    await jumped.stop();
    const plain = startCli(['replay', SEGMENT], env());
    await plain.waitFor(/listening/);
    const t0 = Date.now();
    while (!plain.stderr().includes('replay finished') && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 300));
    expect((plain.stderr().match(/replay finished/g) ?? []).length).toBe(1);
    await plain.stop();
  });
  it.each([
    ['a gzip file with an invalid pwrec header', (dir: string) => { const f = join(dir, 'badheader.pwrec.gz'); writeFileSync(f, gzipSync('this is not a pwrec header\n')); return f; }],
    ['a file that is not gzip', (dir: string) => { const f = join(dir, 'garbage.pwrec.gz'); writeFileSync(f, 'this is not a recording'); return f; }],
  ])('%s with --at-lap exits 1 with a pitwall: message instead of hanging before listening', async (_name, build) => {
    const bad = build(tmp());
    const r = await runCli(['replay', bad, '--at-lap', '5'], env());
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^pitwall: /m);
    expect(r.stdout).not.toContain('listening');
  }, 15_000);
  it('a crash-cut (truncated) recording is not a failure: it replays up to its last flush, a jump past it ends with beyondEnd', async () => {
    const f = join(tmp(), 'truncated.pwrec.gz'); writeFileSync(f, readFileSync(SEGMENT).subarray(0, 3000));
    const replay = startCli(['replay', f, '--paused', '--at-lap', '5'], env());
    await replay.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/);
    expect(replay.stderr()).not.toMatch(/failed|error/i);
    expect(await replay.stop()).toBe(0);
  }, 15_000);
  it('--at-lap beyond the end has reached the end before listening is printed', async () => {
    expect(await firstStatus(['--paused', '--at-lap', '99'])).toMatchObject({ atEnd: true, note: 'beyondEnd' });
  });
  it.each([
    [['--speed', '0']], [['--speed', 'fast']], [['--at-lap', '0']], [['--at-lap', 'x']], [['--at-time', '-5']], [['--at-lap', '2', '--at-time', '5']],
  ])('rejects %j with a pitwall: message and exit 1, before listening', async (flags) => {
    const r = await runCli(['replay', SEGMENT, ...flags], env());
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^pitwall: /m);
    expect(r.stdout).not.toContain('listening');
  });
});
