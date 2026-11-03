import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { feedId, type MachineId, type Span } from '@pitwall/domain';
import { MACHINES, SessionRunner, SessionTracker, STEP0_CLOCK, type Frame, type TrackerEvent } from '@pitwall/engine';
import { decode } from '@pitwall/protocol';
import { readPwrec } from '../../pwrec/reader.ts';
import { StartupError } from '../../startup-error.ts';
import type { CliIo } from '../io.ts';

/** Per sub-machine: transition counts keyed by `<from> -> <to>`, and the spans the session's end closed, by kind. */
type Counts = Map<MachineId, { transitions: Map<string, number>; closedAtEnd: Map<string, number> }>;

const NONE = 'none';

const add = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/** The scope a span is about: a car, a zone or the session. */
const scopeKey = (span: Span): string => (span.carId !== undefined ? `car:${span.carId}` : span.zone !== undefined ? `zone:${span.zone}` : 'session');

/**
 * Adds the transitions of one session's spans (closed, so complete: `closeSession` closed the open ones on the frame
 * after the last, `endFrame`) to `counts`, per sub-machine and scope (the session, a car by `carId`, a zone by `zone`),
 * by frame number (C26): a span's successor opens on the frame it closed on (`<kind> -> <next>`); a span closed with no
 * successor on its frame is `<kind> -> none` (and the next one, if any, `none -> <next>`). The spans the session's end
 * closed are no sub-machine's decision: counted apart, by kind.
 */
function countTransitions(spans: Record<MachineId, readonly Span[]>, endFrame: number, counts: Counts): void {
  for (const [machine, list] of Object.entries(spans)) {
    const byMachine = counts.get(machine) ?? { transitions: new Map<string, number>(), closedAtEnd: new Map<string, number>() };
    counts.set(machine, byMachine);
    const byScope = new Map<string, Span[]>();
    for (const span of list) byScope.set(scopeKey(span), [...(byScope.get(scopeKey(span)) ?? []), span]);
    for (const scoped of byScope.values()) {
      let last: Span | undefined;
      for (const span of [...scoped].sort((a, b) => a.startFrame - b.startFrame || a.id - b.id)) {
        if (last !== undefined && last.endFrame !== span.startFrame) {
          add(byMachine.transitions, `${last.kind} -> ${NONE}`);
          last = undefined;
        }
        add(byMachine.transitions, `${last?.kind ?? NONE} -> ${span.kind}`);
        last = span;
      }
      if (last === undefined) continue;
      if (last.endFrame === endFrame) add(byMachine.closedAtEnd, last.kind);
      else add(byMachine.transitions, `${last.kind} -> ${NONE}`);
    }
  }
}

/** Runs one recording's datagrams through frame assembly and the engine, session by session, counting the transitions. */
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
      countTransitions(runner.state.history.spans, runner.state.frameNumber + 1, counts);
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
 * `pitwall scan-situations [dir]`: runs frame assembly and the engine over every `.pwrec.gz` of `dir` (default
 * `PITWALL_FIXTURES_DIR`) and prints, per sub-machine and for step 0's clock, each transition with its count
 * (`<machine> <from> -> <to> <n>`), each declared transition never seen (`<machine> never seen <from> -> <to>`), each
 * undeclared one (`<machine> undeclared <from> -> <to> <n>`) and, apart from the transitions, the spans the session's
 * end closed per kind (`<machine> closed at session end <kind> <n>`). A span a sub-machine closed with no successor on
 * its frame is `<kind> -> none`, undeclared (every sub-machine covers its scope without gaps). Exit code 1 when a
 * transition occurred that its machine does not declare.
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
  for (const machine of [STEP0_CLOCK, ...MACHINES]) {
    const seen = counts.get(machine.id) ?? { transitions: new Map<string, number>(), closedAtEnd: new Map<string, number>() };
    const declared = new Set(machine.transitions.map(([from, to]) => `${from} -> ${to}`));
    for (const [transition, n] of seen.transitions) {
      if (declared.has(transition)) io.out(`${machine.id} ${transition} ${n}`);
      else {
        undeclared++;
        io.out(`${machine.id} undeclared ${transition} ${n}`);
      }
    }
    for (const transition of declared) if (!seen.transitions.has(transition)) io.out(`${machine.id} never seen ${transition}`);
    for (const [kind, n] of seen.closedAtEnd) io.out(`${machine.id} closed at session end ${kind} ${n}`);
  }
  return undeclared > 0 ? 1 : 0;
}
