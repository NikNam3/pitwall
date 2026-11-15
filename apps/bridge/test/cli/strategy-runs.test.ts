// `pitwall strategy <recording> --at-lap n --runs n` (SP4.3c Task 22a, T19; C47 as changed by the user, C38, C58):
// `--runs n` sets the `strategy` config's `n0` to n and lifts `maxScenarioPolicies` for this call (R40)
// only, on top of the recording's config sidecar. Without `--runs` the sidecar's values reach the job. The call stores
// nothing, publishes nothing and writes no sidecar: the recording's folder (the recording and its sidecars) and the data
// dir are byte-identical afterwards. `--runs` must be a whole number from 1, else a usage error, as `--at-lap` and
// `--car` are.
//
// The recording: a copy of the segment `race-zandvoort-lap10` (C84) in a temporary folder, with a config sidecar of
// its own whose `strategy` counts differ from the data dir's `config.json` (the sidecar wins, C47), so the job's input
// shows which one it got. Rows 1 and 2 replace the `strategy` job's worker module with `strategy-runs-stub-job.ts`,
// which prints the counts it saw as the metadata line's `scenarios` (n0) and `candidates` (maxScenarioPolicies). Rows 3
// and 4 run through `main` (the flag's parsing included), row 3 with the real job.
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';
import type { Feature } from '../../src/features/feature.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { segmentPath } from '../fixtures/replay.ts';

const SEGMENT = segmentPath('race-zandvoort-lap10.pwrec.gz');
/** Car 1 (the player) completes lap 9, its last crossing of the segment. */
const LAST_LAP = '9';
const PLAYER = 1;

type Values = { 'at-lap'?: string; car?: string; json?: string; runs?: string };
type StrategyCommand = { run(positionals: string[], values: Values, io: CliIo, features?: readonly Feature[]): Promise<number> };
const COMMAND: string = new URL('../../src/cli/commands/strategy.ts', import.meta.url).href;
const command = async (): Promise<StrategyCommand> => (await import(/* @vite-ignore */ COMMAND)) as StrategyCommand;

/** The features with the `strategy` job's worker module replaced by the echoing stub. */
const ECHOING: Feature[] = FEATURES.map((f) =>
  f.jobs === undefined
    ? f
    : { ...f, jobs: f.jobs.map((job) => (job.id === 'strategy' ? { ...job, module: new URL('./strategy-runs-stub-job.ts', import.meta.url) } : job)) },
);

const temp = (name: string): string => mkdtempSync(join(tmpdir(), `pitwall-strategy-runs-${name}-`));

/** The data dir's `config.json`: small caps (as `strategy.test.ts`), so the real job's run stays short. */
const DATA_CONFIG = {
  strategy: { maxScenarioPolicies: 200, n0: 10, dpPlansMax: 2, rescoreTop: 2 },
  'sc-call': { maxScenarioPolicies: 100 },
  undercut: { maxScenarioPolicies: 100 },
  'pit-sweep': { maxScenarioPolicies: 100 },
};
/** The recording's own config sidecar: other counts than the data dir's, so the job's input shows the sidecar won. */
const SIDECAR_N0 = 12;
const SIDECAR_CAP = 300;
const SIDECAR = { ...DATA_CONFIG, strategy: { ...DATA_CONFIG.strategy, n0: SIDECAR_N0, maxScenarioPolicies: SIDECAR_CAP } };

/** A temporary data dir with `config.json`, and a copy of the segment with its config sidecar in a folder of its own. */
function setup() {
  const dataDir = temp('data');
  writeFileSync(join(dataDir, 'config.json'), `${JSON.stringify(DATA_CONFIG, null, 2)}\n`);
  const recDir = temp('rec');
  const recording = join(recDir, basename(SEGMENT));
  copyFileSync(SEGMENT, recording);
  writeFileSync(`${recording}.config.json`, `${JSON.stringify(SIDECAR, null, 2)}\n`);
  const out: string[] = [], err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: { PITWALL_DATA_DIR: dataDir }, signal: new AbortController().signal };
  return { io, dataDir, recDir, recording, stdout: () => out.join('\n'), stderr: () => err.join('\n') };
}

/** Every file of `dir` (flat), by name, with its bytes. */
function filesOf(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name)).toString('base64')]));
}

/** The metadata line of car `car`: the indented line after its heading holding `scenarios <n>`. */
function metaLine(stdout: string, car: number): string | undefined {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => l === `car ${car}` || l.startsWith(`car ${car} `));
  if (start === -1) return undefined;
  return lines.slice(start + 1).find((l) => /\bscenarios \d+/.test(l));
}

describe('pitwall strategy --runs', { timeout: 180_000 }, () => {
  it('--runs 4000 reaches the job as n0 and maxScenarioPolicies, over the sidecar', async () => {
    const { io, recording, stdout, stderr } = setup();
    const code = await (await command()).run([recording], { 'at-lap': LAST_LAP, runs: '4000' }, io, ECHOING);
    expect(code, stderr()).toBe(0);
    const meta = metaLine(stdout(), PLAYER);
    expect(meta, stdout()).toBeDefined();
    expect(meta).toContain('scenarios 4000');
    // the cap is lifted for the call (supervisor ruling R40): n scenarios per candidate, never cut by the cap
    expect(meta).toContain(`candidates ${Number.MAX_SAFE_INTEGER}`);
  });

  it('without --runs the job sees the sidecar\'s counts', async () => {
    const { io, recording, stdout, stderr } = setup();
    const code = await (await command()).run([recording], { 'at-lap': LAST_LAP }, io, ECHOING);
    expect(code, stderr()).toBe(0);
    const meta = metaLine(stdout(), PLAYER);
    expect(meta, stdout()).toBeDefined();
    expect(meta).toContain(`scenarios ${SIDECAR_N0}`);
    expect(meta).toContain(`candidates ${SIDECAR_CAP}`);
  });

  it('stores nothing: the recording\'s folder and the data dir are byte-identical after the call', async () => {
    const { io, dataDir, recDir, recording, stderr } = setup();
    const recBefore = filesOf(recDir);
    const dataBefore = filesOf(dataDir);
    const code = await main(['strategy', recording, '--at-lap', LAST_LAP, '--runs', '4000'], io);
    expect(code, stderr()).toBe(0);
    expect(filesOf(recDir)).toEqual(recBefore);
    expect(filesOf(dataDir)).toEqual(dataBefore);
  });

  it.each(['0', 'x', '-3', '2.5'])('--runs %s is a usage error', async (runs) => {
    const { io, dataDir, recDir, recording, stderr } = setup();
    const recBefore = filesOf(recDir);
    const dataBefore = filesOf(dataDir);
    const code = await main(['strategy', recording, '--at-lap', LAST_LAP, `--runs=${runs}`], io);
    expect(code).toBe(1);
    expect(stderr()).toMatch(/--runs needs a whole number from 1/);
    expect(filesOf(recDir)).toEqual(recBefore);
    expect(filesOf(dataDir)).toEqual(dataBefore);
  });
});
