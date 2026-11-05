import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { feedId, type MachineId, type PenaltyRecord, type Span, type WarnedDetail } from '@pitwall/domain';
import { MACHINES, SessionRunner, SessionTracker, STEP0_CLOCK, type Frame, type TrackerEvent } from '@pitwall/engine';
import { membershipOf } from '@pitwall/engine/readers';
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
async function scanRecording(path: string, counts: Counts, signal: AbortSignal, onSession?: (runner: SessionRunner) => void): Promise<void> {
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
      onSession?.(runner);
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

const PENALTY_WORDS: Record<PenaltyRecord['kind'], string> = { time: 'time penalty', driveThrough: 'drive-through', stopGo: 'stop-go' };

/**
 * The rows of the warnings table for one finished session: each penalty of the player car, `<phase>, <kind>
 * (infringement <n>): warnings <count>, cornerCutting <n>`, the `warned` span being the one the projection's membership
 * gives for the penalty (C26), the phase that of the weekend-phase span covering its frame.
 */
function warningRows(runner: SessionRunner): string[] {
  const { history, playerCar } = runner.state;
  return history.penalties
    .filter((penalty) => penalty.carId === playerCar)
    .map((penalty) => {
      const member = membershipOf({ history }, penalty);
      const phase = member['weekend-phase']?.kind ?? NONE;
      const infringement = penalty.infringement.known ? String(penalty.infringement.value) : 'unknown';
      const warned = member.warnings?.kind === 'warned' ? (member.warnings.detail as WarnedDetail) : undefined;
      const held = warned === undefined ? 'no warned span' : `warnings ${warned.count}, cornerCutting ${warned.cornerCutting ?? 'unknown'}`;
      return `${phase}, ${PENALTY_WORDS[penalty.kind]} (infringement ${infringement}): ${held}`;
    });
}

/**
 * `pitwall scan-situations [dir]`: runs frame assembly and the engine over every `.pwrec.gz` of `dir` (default
 * `PITWALL_FIXTURES_DIR`) and prints, per sub-machine and for step 0's clock, each transition with its count
 * (`<machine> <from> -> <to> <n>`), each declared transition never seen (`<machine> never seen <from> -> <to>`), each
 * undeclared one (`<machine> undeclared <from> -> <to> <n>`) and, apart from the transitions, the spans the session's
 * end closed per kind (`<machine> closed at session end <kind> <n>`). A span a sub-machine closed with no successor on
 * its frame is `<kind> -> none`, undeclared (every sub-machine covers its scope without gaps). Exit code 1 when a
 * transition occurred that its machine does not declare. With `--warnings`: instead, per recording, one row per penalty
 * of the player car with the `warned` span it belongs to (`warningRows`); exit code 0.
 */
export async function run(
  positionals: string[],
  values: { warnings?: boolean | undefined },
  io: CliIo,
): Promise<number> {
  const dir = positionals[0] ?? io.env.PITWALL_FIXTURES_DIR;
  if (dir === undefined) throw new StartupError('scan-situations needs a directory: give one or set PITWALL_FIXTURES_DIR');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.pwrec(\.gz)?$/.test(f)).sort();
  if (values.warnings) {
    for (const file of files) {
      const rows: string[] = [];
      await scanRecording(join(dir, file), new Map(), io.signal, (runner) => rows.push(...warningRows(runner)));
      io.out(file);
      for (const row of rows) io.out(row);
    }
    return 0;
  }
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
