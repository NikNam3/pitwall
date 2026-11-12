import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FORECAST_SCORE } from '@pitwall/analysis';
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { unknown, type ForecastScoreReport, type Known, type ScoreTable } from '@pitwall/domain';
import type { Job } from '@pitwall/engine/readers';
import { loadFeatureConfig, recordingConfig } from '../../feature-config.ts';
import type { Feature } from '../../features/feature.ts';
import { FEATURES } from '../../features/index.generated.ts';
import type { PacketSource, RawPacket } from '../../input/packet-source.ts';
import { PwrecSource } from '../../input/pwrec-source.ts';
import type { FeedPipeline } from '../../pipeline/feed-pipeline.ts';
import { StartupError } from '../../startup-error.ts';
import { cliLogger, EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { RECORDING_FEED, recordingHub, recordingPipeline, runToEnd } from '../process-recording.ts';
import { UsageError } from '../usage.ts';

const TOPIC: TopicName = 'forecastScore.report';
const CLIENT = 'pitwall-score';
const SUBSCRIPTION = 'report';

type Report = ForecastScoreReport;
type Forecast = Report['forecasts'][number];
type Summary = ScoreTable['ai'];
/** A table as `--json` writes it and `--compare` reads it: without its cases. */
type Table = Omit<ScoreTable, 'cases'>;
type JsonReport = { experiments: Record<keyof Report['experiments'], Table>; forecasts: (Omit<Forecast, 'lapTime' | 'position' | 'baselinePosition'> & Record<ForecastTable, Table>)[] };

const EXPERIMENTS = ['rejoin', 'undercut', 'scStop'] as const;
const FORECAST_TABLES = ['lapTime', 'position', 'baselinePosition'] as const;
type ForecastTable = (typeof FORECAST_TABLES)[number];
/** The horizons and bases of the report printed when the job delivered nothing (R33): the job's defaults. */
const HORIZONS: readonly Forecast['horizon'][] = [1, 3, 5, 10];
const BASES: readonly Forecast['basis'][] = ['wear', 'age'];

/**
 * Whether a forecast-score job is under way: the CLI holds the recording back while one is, so the session's end never
 * cancels the run of the final leader lap (`FeedJobs.sessionEnded`). A run starts when its trigger calculator ran (the
 * job's `prepare`) and ends with the next message on the subscription (its result, or the topic marked errored).
 */
class JobGate {
  #running = false;
  #waiting: Array<() => void> = [];

  started(): void {
    this.#running = true;
  }

  ended(): void {
    this.#running = false;
    for (const resolve of this.#waiting.splice(0)) resolve();
  }

  /** Resolves once no run is under way, or once `signal` aborts. */
  idle(signal: AbortSignal): Promise<void> {
    if (!this.#running || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      this.#waiting.push(done);
      signal.addEventListener('abort', done, { once: true });
    });
  }
}

/** The recording, as fast as possible, each record (and the end of the input) held back while a job is under way. */
class GatedSource implements PacketSource {
  readonly feedId = RECORDING_FEED;
  readonly done: Promise<void>;
  readonly #inner: PwrecSource;
  readonly #stopping = new AbortController();

  constructor(path: string, gate: JobGate) {
    this.#inner = new PwrecSource({ feedId: RECORDING_FEED, path, pacer: { wait: (_gapMs, signal) => gate.idle(signal) } });
    this.done = this.#inner.done.then(() => gate.idle(this.#stopping.signal));
    this.done.catch(() => {});
  }

  start(onPacket: (packet: RawPacket) => void): void {
    this.#inner.start(onPacket);
  }

  async stop(): Promise<void> {
    this.#stopping.abort();
    await this.#inner.stop();
    await this.done.catch(() => {});
  }
}

/** The features, the forecast-score job's `prepare` telling `gate` that a run starts. */
function gatedFeatures(gate: JobGate): Feature[] {
  const gated = (job: Job<unknown, unknown>): Job<unknown, unknown> =>
    job.id !== FORECAST_SCORE
      ? job
      : {
          ...job,
          prepare: (view) => {
            const input = job.prepare(view);
            gate.started();
            return input;
          },
        };
  return FEATURES.map((feature) => (feature.jobs === undefined ? feature : { ...feature, jobs: feature.jobs.map(gated) }));
}

/** The data dir's root as `dataDir` resolves it, without creating anything (the command stores nothing, C32). */
function dataRoot(env: CliIo['env']): string {
  return env['PITWALL_DATA_DIR'] || join(env['HOME'] ?? homedir(), '.local', 'share', 'pitwall');
}

/** The report of a run that delivered no job result (R33): every count 0, every mean unknown. */
function emptyReport(): Report {
  const empty = (name: string, unit: ScoreTable['unit']): ScoreTable => {
    const none: Summary = { n: 0, meanAbs: unknown('insufficientData'), bias: unknown('insufficientData') };
    return { name, unit, ai: none, human: { ...none }, cases: [] };
  };
  return {
    experiments: { rejoin: empty('rejoin', 'places'), undercut: empty('undercut', 'ms'), scStop: empty('scStop', 'ms') },
    forecasts: HORIZONS.flatMap((horizon) =>
      BASES.map((basis) => ({
        horizon,
        basis,
        lapTime: empty(`h${horizon}.${basis}.lapTime`, 'ms'),
        position: empty(`h${horizon}.${basis}.position`, 'places'),
        baselinePosition: empty(`h${horizon}.${basis}.baselinePosition`, 'places'),
      })),
    ),
  };
}

const withoutCases = ({ cases: _cases, ...table }: ScoreTable): Table => table;

/** The report as `--json` writes it: every table without its cases. */
function jsonReport(report: Report): JsonReport {
  return {
    experiments: { rejoin: withoutCases(report.experiments.rejoin), undercut: withoutCases(report.experiments.undercut), scStop: withoutCases(report.experiments.scStop) },
    forecasts: report.forecasts.map((f) => ({
      horizon: f.horizon,
      basis: f.basis,
      lapTime: withoutCases(f.lapTime),
      position: withoutCases(f.position),
      baselinePosition: withoutCases(f.baselinePosition),
    })),
  };
}

/** A number of a table: whole ms, places to two decimals. */
const formatValue = (value: number, unit: Table['unit']): string => (unit === 'ms' ? String(Math.round(value)) : value.toFixed(2));
const formatChange = (change: number, unit: Table['unit']): string => {
  const text = formatValue(change, unit);
  if (Number(text) === 0) return formatValue(0, unit); // never "-0.00"
  return change > 0 ? `+${text}` : text;
};
const formatKnown = (value: Known<number>, unit: Table['unit']): string => (value.known ? formatValue(value.value, unit) : 'unknown');

/** A count, with `--compare` its old value and change. */
function countText(n: number, old: Summary | undefined): string {
  if (old === undefined) return `n ${n}`;
  const change = n - old.n;
  return `n ${n} (was ${old.n}, ${change > 0 ? `+${change}` : String(change)})`;
}

/** A mean, with `--compare` its old value and change. */
function knownText(value: Known<number>, old: Known<number> | undefined, unit: Table['unit']): string {
  const now = formatKnown(value, unit);
  if (old === undefined) return now;
  if (!value.known || !old.known) return `${now} (was ${formatKnown(old, unit)})`;
  return `${now} (was ${formatKnown(old, unit)}, ${formatChange(value.value - old.value, unit)})`;
}

/** One table: its heading, then one line per driver type with its count, mean absolute error and bias. */
function tableLines(heading: string, table: Table, old: Table | undefined): string[] {
  const line = (driver: 'ai' | 'human') => {
    const s = table[driver];
    const o = old?.[driver];
    return `  ${driver.padEnd(5)} ${countText(s.n, o)}  mean abs ${knownText(s.meanAbs, o?.meanAbs, table.unit)}  bias ${knownText(s.bias, o?.bias, table.unit)}`;
  };
  return [`${heading} (${table.unit})`, line('ai'), line('human')];
}

/** Every table of the report: the experiments, then per horizon and basis the forecast's three. */
function reportLines(report: JsonReport, old: JsonReport | undefined): string[] {
  const lines: string[] = [];
  for (const name of EXPERIMENTS) lines.push(...tableLines(name, report.experiments[name], old?.experiments?.[name]));
  for (const f of report.forecasts) {
    const was = old?.forecasts?.find((o) => o.horizon === f.horizon && o.basis === f.basis);
    for (const kind of FORECAST_TABLES) lines.push(...tableLines(`h${f.horizon} ${f.basis} ${kind}`, f[kind], was?.[kind]));
  }
  return lines;
}

/** The old report of `--compare`. */
function readOld(file: string): JsonReport {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as JsonReport;
  } catch (error) {
    throw new StartupError(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * `pitwall score <recording> [--json <file>] [--compare <old.json>]` (SP4.3a spec 7.2): reprocesses the recording as
 * `pitwall reprocess` does, its sidecars included (R27, C38), with `forecastScore.report` subscribed, waits for the job
 * result of the final leader lap and prints one table per experiment and per forecast horizon and basis, AI and human
 * apart. A run without a job result prints the all-zero report (R33). `--json` writes the report without its cases;
 * `--compare` prints each number beside the old one with its change. Stores nothing (C32): no database, no session
 * files, nothing under the data dir.
 */
export async function run(positionals: string[], values: { json?: string | undefined; compare?: string | undefined }, io: CliIo): Promise<number> {
  const path = positionals[0];
  if (path === undefined) throw new UsageError('score needs a recording file');
  const old = values.compare === undefined ? undefined : readOld(values.compare);
  const log = cliLogger(io, 'warn');
  const config = recordingConfig(path, FEATURES, loadFeatureConfig(dataRoot(io.env), FEATURES), log);

  const gate = new JobGate();
  let latest: { report: Report } | { failed: true } | undefined;
  let pipeline: FeedPipeline | undefined = undefined;
  // Every call is an hour after the one before: the hub never throttles this only subscriber, each result goes out at once.
  let clock = 0;
  const hub = recordingHub(() => pipeline, () => (clock += 3_600_000));
  pipeline = recordingPipeline({ path, hub, log, config, features: gatedFeatures(gate), source: new GatedSource(path, gate) });
  hub.addClient(CLIENT, {
    send: (message: ServerMessage) => {
      if (message.type === 'update' || (message.type === 'snapshot' && message.value !== undefined)) {
        latest = { report: (message.value as { value: Report }).value };
      } else if (message.type === 'topicStatus' && message.status === 'errored') {
        latest = { failed: true };
      }
      gate.ended();
    },
    bufferedAmount: () => 0,
  });
  hub.subscribe({ clientId: CLIENT, id: SUBSCRIPTION, topic: TOPIC, params: {}, feedId: RECORDING_FEED });

  try {
    await runToEnd(pipeline, path, io.signal);
  } catch (error) {
    if (!io.signal.aborted) throw error;
    io.err('pitwall: interrupted');
    return EXIT_INTERRUPTED;
  }
  if (latest !== undefined && 'failed' in latest) {
    io.err('pitwall: the forecast-score job failed (see the log above)');
    return 1;
  }
  const report = jsonReport(latest?.report ?? emptyReport());
  for (const line of reportLines(report, old)) io.out(line);
  if (values.json !== undefined) {
    try {
      writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      throw new StartupError(`cannot write ${values.json}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return 0;
}
