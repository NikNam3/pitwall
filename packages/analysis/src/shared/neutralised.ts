// The neutralisations of a session (contract C18, C20, C43, C45): the one source `gaps`, `incidents` and `race-moment`
// read, so they agree on what was neutralised. A neutralisation is a span of a session-phase sub-machine: the race's
// `neutralised` (SC, VSC) and `suspended` (red flag) spans, and the `suspended` spans of qualifying and practice.
import type { FrameNumber, LapRecord, MachineId, NeutralisedDetail, OpenSpan, Span } from '@pitwall/domain';
import type { DeepReadonly, EngineView } from '@pitwall/engine/readers';

/** The span kinds that are a neutralisation, by session-phase sub-machine; the readers declare each `spans:<machine>` (C41). */
const NEUTRALISING: Readonly<Record<MachineId, readonly string[]>> = {
  'session-phase-race': ['neutralised', 'suspended'],
  'session-phase-qualifying': ['suspended'],
  'session-phase-practice': ['suspended'],
};

/** The session-phase sub-machines `neutralisedSpans` reads: what a reader declares as `spans:<machine>`. */
export const NEUTRALISATION_READS = ['spans:session-phase-race', 'spans:session-phase-qualifying', 'spans:session-phase-practice'] as const;

/** The session-phase sub-machines whose spans can be a neutralisation, in the order `neutralisedSpans` reads them. */
export const NEUTRALISATION_MACHINES: readonly MachineId[] = Object.keys(NEUTRALISING);

/** A neutralisation, closed (from the projection) or open (from the situation, no `end` and no `endFrame`). */
export type Neutralisation = DeepReadonly<Span> | DeepReadonly<OpenSpan>;

/** What a neutralisation is for a display: the neutralising car of a `neutralised` span, `red` for a suspension. */
export type NeutralisationKind = 'SC' | 'VSC' | 'red';

/** The span is closed: it has its end (C20); an open one has none yet. */
export const isClosed = (span: Neutralisation): span is DeepReadonly<Span> => 'endFrame' in span;

/** The kind of a neutralisation: a `neutralised` span's car (SC or VSC), `red` for a `suspended` span. */
export const neutralisationKind = (span: Neutralisation): NeutralisationKind =>
  span.kind === 'neutralised' ? (span.detail as NeutralisedDetail).car : 'red';

/**
 * The session's neutralisations (C20): the closed ones of the projection in their order, then the open one of the
 * situation. A `neutralised` span closed with `confirmed: false` is none (C18); one still open and pending its
 * confirmation is one, from its earliest reliable signal.
 */
export function neutralisedSpans(projection: Pick<EngineView['history'], 'spans'>, situation: EngineView['situation']): ReadonlyArray<Neutralisation> {
  const closed: Neutralisation[] = [];
  const open: Neutralisation[] = [];
  for (const machine of NEUTRALISATION_MACHINES) {
    for (const span of projection.spans[machine] ?? []) if (isNeutralisation(machine, span)) closed.push(span);
    for (const span of situation.byMachine[machine] ?? []) if (isNeutralisation(machine, span)) open.push(span);
  }
  return [...closed, ...open];
}


/**
 * Whether a span of `machine` is a neutralisation, as `neutralisedSpans` counts it: a neutralising kind, and for a
 * `neutralised` span closed with `confirmed: false`, none (C18).
 */
export function isNeutralisation(machine: MachineId, span: Neutralisation): boolean {
  const kinds = NEUTRALISING[machine];
  if (kinds === undefined || !kinds.includes(span.kind)) return false;
  return !isClosed(span) || span.confirmed || span.kind !== 'neutralised';
}

/**
 * The leader's lap at `frame` (C26, C45): one more than the most laps any car completed by that frame, the frame itself
 * included, from the projection's laps (a provisional lap and the confirmed one that supersedes it are one lap, C25);
 * lap 1 before any lap is completed.
 */
export function leaderLapAt(laps: readonly DeepReadonly<Pick<LapRecord, 'lapNumber' | 'frame'>>[], frame: FrameNumber): number {
  let completed = 0;
  for (const lap of laps) if (lap.frame <= frame && lap.lapNumber > completed) completed = lap.lapNumber;
  return completed + 1;
}
