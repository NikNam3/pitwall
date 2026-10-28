// `pitwall replay <file> [--paused] [--speed <n>] [--at-lap <n> | --at-time <ms>]` (Task 5, requirement 5).
import { mkdtempSync } from 'node:fs';
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
  it('--paused starts paused, at the start', async () => {
    const status = await firstStatus(['--paused']);
    expect(status).toMatchObject({ paused: true, speed: 1, atEnd: false });
  });
  it('--speed sets the speed', async () => {
    expect(await firstStatus(['--paused', '--speed', '2'])).toMatchObject({ paused: true, speed: 2 });
  });
  it('--at-time has jumped before listening is printed, and --paused keeps it there', async () => {
    const status = await firstStatus(['--paused', '--at-time', '20000']);
    expect(status.sessionTimeMs).toBeGreaterThanOrEqual(20_000);
    expect(status).toMatchObject({ paused: true, atEnd: false });
  });
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
