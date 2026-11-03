import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { feedId, type MachineId, type Span } from '@pitwall/domain';
import { MACHINES, SessionRunner, SessionTracker, type Frame, type TrackerEvent } from '@pitwall/engine';
import { decode } from '@pitwall/protocol';
import { readPwrec } from '../../pwrec/reader.ts';
import { StartupError } from '../../startup-error.ts';
import type { CliIo } from '../io.ts';

/** Transition counts of every sub-machine, keyed by `<from> -> <to>`. */
type Counts = Map<MachineId, Map<string, number>>;

const NONE = 'none';

/** Adds the transitions of `spans` (closed, so complete) to `counts`: per sub-machine and car, each span follows the one before. */
function countTransitions(spans: Record<MachineId, readonly Span[]>, counts: Counts): void {
  for (const [machine, list] of Object.entries(spans)) {
    const byMachine = counts.get(machine) ?? new Map<string, number>();
    counts.set(machine, byMachine);
    const last = new Map<number | undefined, string>();
    for (const span of [...list].sort((a, b) => a.start - b.start || a.id - b.id)) {
      const key = `${last.get(span.carId) ?? NONE} -> ${span.kind}`;
      byMachine.set(key, (byMachine.get(key) ?? 0) + 1);
      last.set(span.carId, span.kind);
    }
  }
}

/** Runs one recording's datagrams through frame assembly and steps 0-2, session by session, counting the transitions. */
async function scanRecording(path: string, counts: Counts, signal: AbortSignal): Promise<void> {
  const tracker = new SessionTracker({ feedId: feedId('replay') });
  let runner: SessionRunner | undefined;
  const handle = (event: TrackerEvent): void => {
    if (event.type === 'sessionStarted') {
      runner = new SessionRunner({ feedId: feedId('replay'), sessionUid: event.sessionUid, session: event.session, realism: false });
    } else if (event.type === 'frame') {
      runner?.apply(event.frame satisfies Frame);
    } else if (runner) {
      runner.finish();
      countTransitions(runner.state.history.spans, counts);
      runner = undefined;
    }
  };
  try {
    for await (const record of readPwrec(path)) {
      if (signal.aborted) throw new StartupError('interrupted');
      const decoded = decode(record.payload);
      if (decoded.ok) for (const event of tracker.push(decoded.packet, record.t)) handle(event);
    }
  } catch (error) {
    if (error instanceof StartupError) throw error;
    throw new StartupError(`cannot scan ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const event of tracker.end()) handle(event);
}

/**
 * `pitwall scan-situations [dir]`: runs frame assembly and steps 0-2 over every `.pwrec.gz` of `dir` (default
 * `PITWALL_FIXTURES_DIR`) and prints, per sub-machine, each transition with its count (`<machine> <from> -> <to> <n>`),
 * each declared transition never seen (`<machine> never seen <from> -> <to>`) and each undeclared one
 * (`<machine> undeclared <from> -> <to> <n>`). Exit code 1 when a transition occurred that its machine does not declare.
 */
export async function run(
  positionals: string[],
  _values: unknown,
  io: CliIo,
): Promise<number> {
  const dir = positionals[0] ?? io.env.PITWALL_FIXTURES_DIR;
  if (dir === undefined) throw new StartupError('scan-situations needs a directory: give one or set PITWALL_FIXTURES_DIR');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.pwrec(\.gz)?$/.test(f)).sort();
  const counts: Counts = new Map();
  for (const file of files) await scanRecording(join(dir, file), counts, io.signal);

  let undeclared = 0;
  for (const machine of MACHINES) {
    const seen = counts.get(machine.id) ?? new Map<string, number>();
    const declared = new Set(machine.transitions.map(([from, to]) => `${from} -> ${to}`));
    for (const [transition, n] of seen) {
      if (declared.has(transition)) io.out(`${machine.id} ${transition} ${n}`);
      else {
        undeclared++;
        io.out(`${machine.id} undeclared ${transition} ${n}`);
      }
    }
    for (const transition of declared) if (!seen.has(transition)) io.out(`${machine.id} never seen ${transition}`);
  }
  return undeclared > 0 ? 1 : 0;
}
