import { writeFileSync } from 'node:fs';
import { STRATEGY } from '@pitwall/analysis';
import type { Computed, ServerMessage, TopicName } from '@pitwall/contracts';
import { carId, type CarId, type McRow, type StrategyOutput } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { loadFeatureConfig, recordingConfig } from '../../feature-config.ts';
import type { Feature } from '../../features/feature.ts';
import { FEATURES } from '../../features/index.generated.ts';
import type { FeedPipeline } from '../../pipeline/feed-pipeline.ts';
import { StartupError } from '../../startup-error.ts';
import { cliLogger, EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { GatedSource, gatedFeatures, JobGate } from '../job-gate.ts';
import { RECORDING_FEED, recordingHub, recordingPipeline, runToEnd } from '../process-recording.ts';
import { UsageError } from '../usage.ts';
import { dataRoot } from './score.ts';

const TOPIC: TopicName = 'strategy.plans';
const CLIENT = 'pitwall-strategy';
const SUBSCRIPTION = 'plans';

type Flags = { 'at-lap'?: string | undefined; car?: string | undefined; json?: string | undefined };
type Ranked = Extract<StrategyOutput[CarId], { known: true }>['value'];

/** A whole number from `min`, or a usage error naming the flag. */
function wholeNumber(flag: string, text: string, min: number): number {
  const n = Number(text);
  if (text.trim() === '' || !Number.isInteger(n) || n < min) throw new UsageError(`--${flag} needs a whole number from ${min}, got "${text}"`);
  return n;
}

const percent = (p: number): number => Math.round(p * 100);

/** One ranked row: rank, source, stops, triggers, E[pos], E[points], mean time, the position pmf, tie, committed. */
function rowLine(rank: number, row: McRow): string {
  const stops = row.policy.stops.length === 0 ? 'no stop' : row.policy.stops.map((s) => `L${s.lap} ${s.compound}`).join(', ');
  // per trigger kind: how many the policy holds and the highest share of scenarios one of them fired in
  const byKind = new Map<string, { n: number; fired: number }>();
  row.policy.triggers.forEach((t, i) => {
    const kind = byKind.get(t.kind) ?? { n: 0, fired: 0 };
    byKind.set(t.kind, { n: kind.n + 1, fired: Math.max(kind.fired, row.triggers[i]?.fired ?? 0) });
  });
  const triggers = [...byKind].map(([kind, { n, fired }]) => `${kind}${n > 1 ? ` x${n}` : ''} fired ${percent(fired)}%`);
  const parts = [
    `${rank}`,
    row.source,
    stops,
    ...(triggers.length === 0 ? [] : [`if ${triggers.join(', ')}`]),
    `E[pos] ${row.ePos.toFixed(2)}`,
    `E[points] ${row.ePoints.toFixed(2)}`,
    `mean ${(row.meanMs / 1000).toFixed(3)} s`,
    `pmf ${row.positionPmf.map(percent).join(' ')}`,
    ...(row.tie ? ['tie'] : []),
    ...(row.committed ? ['committed'] : []),
    ...(row.infeasible === null ? [] : [`infeasible ${row.infeasible}`]),
  ];
  return `  ${parts.join('  ')}`;
}

/** The run's metadata of one car. */
function metaLine(r: Ranked): string {
  const hazard = r.hazard.known ? r.hazard.value : r.hazard.reason;
  return `  scenarios ${r.scenarios}  candidates ${r.candidates}  cap ${r.capHit ? 'hit' : 'not hit'}  hazard ${hazard}${r.unresolvedTie ? '  unresolved near-tie' : ''}`;
}

/** The report: per our car its heading, then its metadata and ranked rows, or its reason. */
function reportLines(output: StrategyOutput, lap: number): string[] {
  const cars = Object.keys(output).map(Number).sort((a, b) => a - b);
  if (cars.length === 0) return [`no strategy result at lap ${lap}`];
  const lines: string[] = [];
  for (const car of cars) {
    const result = output[carId(car)];
    if (result === undefined) continue;
    lines.push(`car ${car}`);
    if (!result.known) {
      lines.push(`  ${result.reason}`);
      continue;
    }
    lines.push(metaLine(result.value));
    result.value.rows.forEach((row, i) => lines.push(rowLine(i + 1, row)));
  }
  return lines;
}

/** Whether the projection holds the record of car `car` completing lap `lap`. */
function completed(view: EngineView, car: CarId, lap: number): boolean {
  return view.history.laps.some((l) => l.carId === car && l.lapNumber === lap);
}

/**
 * `pitwall strategy <recording> --at-lap n [--car id] [--json <file>]` (SP4.3b spec §8.3): reprocesses the recording as
 * `pitwall score` does, its sidecars included (C38), with `strategy.plans` subscribed, up to the frame on which our car
 * (`--car`, default the player car) completes lap n; waits for that frame's job result and prints per our car its
 * ranked rows and the run's metadata. The recording is held back while a job runs. `--json` writes the
 * `StrategyOutput`. No result (a lap the car never completes, a run the session's end cancelled) is an empty report,
 * exit 0 (R50). Stores nothing (C32). `features` is the generated index (a test seam).
 */
export async function run(positionals: string[], values: Flags, io: CliIo, features: readonly Feature[] = FEATURES): Promise<number> {
  const path = positionals[0];
  if (path === undefined) throw new UsageError('strategy needs a recording file');
  if (values['at-lap'] === undefined) throw new UsageError('strategy needs --at-lap n');
  const lap = wholeNumber('at-lap', values['at-lap'], 1);
  const wanted = values.car === undefined ? undefined : carId(wholeNumber('car', values.car, 0));
  const log = cliLogger(io, 'warn');
  const config = recordingConfig(path, features, loadFeatureConfig(dataRoot(io.env), features), log);

  const gate = new JobGate();
  const source = new GatedSource(path, gate);
  /** The run of the target frame was asked for; its result is the next message. */
  let targetAsked = false;
  let reached = false;
  let result: { output: StrategyOutput } | { failed: true } | undefined;
  let pipeline: FeedPipeline | undefined = undefined;
  const onPrepare = (view: EngineView): void => {
    if (reached) return;
    if (!completed(view, wanted ?? view.live.playerCar, lap)) return;
    reached = true;
    targetAsked = true;
  };
  // Every call is an hour after the one before: the hub never throttles this only subscriber, each result goes out at once.
  let clock = 0;
  const hub = recordingHub(() => pipeline, () => (clock += 3_600_000));
  pipeline = recordingPipeline({ path, hub, log, config, features: gatedFeatures(features, STRATEGY, gate, onPrepare), source });
  hub.addClient(CLIENT, {
    send: (message: ServerMessage) => {
      const value = message.type === 'update' || message.type === 'snapshot' ? message.value : undefined;
      const errored = message.type === 'topicStatus' && message.status === 'errored';
      if (targetAsked && (value !== undefined || errored)) {
        targetAsked = false;
        // an error that comes only from the session's end is no result (R50)
        if (value !== undefined) result = { output: (value as Computed<StrategyOutput>).value };
        else if (!source.inputEnded) result = { failed: true };
        setImmediate(() => void pipeline?.stop());
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
  } finally {
    gate.close();
  }
  if (result !== undefined && 'failed' in result) {
    io.err('pitwall: the strategy job failed (see the log above)');
    return 1;
  }
  const output = result?.output ?? {};
  for (const line of reportLines(output, lap)) io.out(line);
  if (values.json !== undefined) {
    try {
      writeFileSync(values.json, `${JSON.stringify(output, null, 2)}\n`);
    } catch (error) {
      throw new StartupError(`cannot write ${values.json}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return 0;
}
