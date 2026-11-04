// The penalties recorder (contract C10, C13, C21, C26, C29): a penalty record for each penalty race control gives a
// car, read from the `penalties` sub-machine's spans, never from a signal (C13). A penalty is given where a car's
// penalties span opens with more unserved drive-throughs or stop-gos than the span it closed, or a higher total of time
// penalties: one record per added penalty, describing the frame its span opened on (C26). A span opened on joining the
// session gives none (the penalty was not seen given); serving a penalty or a falling total gives none.
import { unknown, type CarId, type Known, type PendingPenaltyDetail, type PenaltyRecord, type TimePenaltyDetail } from '@pitwall/domain';
import type { Recorder } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { SituationSpan } from './spans.ts';

const PENALTIES = 'penalties';

/** What a penalties span says the car owes: the unserved drive-throughs and stop-gos, and the time penalties in total. */
type Owed = { dt: number; sg: number; totalMs: number };

const NOTHING_OWED: Owed = { dt: 0, sg: 0, totalMs: 0 };

const owedOf = (span: SituationSpan | undefined): Owed => {
  if (span === undefined) return NOTHING_OWED;
  if (span.kind === 'timePenalty') return { ...NOTHING_OWED, totalMs: (span.detail as DeepReadonly<TimePenaltyDetail>).totalMs };
  if (span.kind === 'driveThroughPending' || span.kind === 'stopGoPending') {
    const { driveThroughs, stopGos, totalMs } = span.detail as DeepReadonly<PendingPenaltyDetail>;
    return { dt: driveThroughs, sg: stopGos, totalMs };
  }
  return NOTHING_OWED;
};

/** The infringement a span names (C3): the head penalty's of a pending span, the total's of a `timePenalty` span. */
const infringementOf = (span: SituationSpan): Known<number> => (span.detail as DeepReadonly<{ infringement: Known<number> }>).infringement;

/**
 * The records of the penalties a span adds over the one before, drive-throughs first, then stop-gos, then the time
 * penalty. Only the penalty the span is named after carries the span's infringement: the first added one of its kind,
 * when the span owes nothing but what it adds; any other added penalty's is unknown (C3).
 */
const addedPenalties = (span: SituationSpan, before: Owed): Array<Omit<PenaltyRecord, 'at' | 'frame'>> => {
  const now = owedOf(span);
  const carId = span.carId as CarId;
  const addedDt = Math.max(0, now.dt - before.dt);
  const addedSg = Math.max(0, now.sg - before.sg);
  const onlyAdded = now.dt + now.sg === addedDt + addedSg;
  const head = span.kind === 'driveThroughPending' ? 'driveThrough' : span.kind === 'stopGoPending' ? 'stopGo' : undefined;
  const given = (kind: 'driveThrough' | 'stopGo', n: number) =>
    Array.from({ length: n }, (_, i) => ({
      carId,
      kind,
      infringement: onlyAdded && i === 0 && head === kind ? infringementOf(span) : unknown('notReceived'),
      timeMs: undefined,
    }));
  const time = now.totalMs > before.totalMs
    ? [{ carId, kind: 'time' as const, infringement: span.kind === 'timePenalty' ? infringementOf(span) : unknown('notReceived'), timeMs: now.totalMs - before.totalMs }]
    : [];
  return [...given('driveThrough', addedDt), ...given('stopGo', addedSg), ...time];
};

/** Reads only the situation (C10); its own open state is empty: the span a car's new span replaced closed on the same frame. */
export const penaltiesRecorder: Recorder<Record<string, never>> = {
  id: 'penalties',
  init: () => ({}),
  apply(input, own, log, out) {
    const closed = input.closed?.[PENALTIES] ?? [];
    let appended = false;
    for (const span of input.situation.byMachine[PENALTIES] ?? []) {
      if (span.startFrame !== input.frameNumber || span.joinedAt === true) continue;
      const before = owedOf(closed.find((s) => s.carId === span.carId));
      for (const body of addedPenalties(span, before)) {
        log.append('penalties', { ...body, at: span.start, frame: span.startFrame });
        appended = true;
      }
    }
    if (appended) out.changed.add('penalties');
    return own;
  },
};
