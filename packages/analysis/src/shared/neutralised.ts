// The neutralisations of a session (contract C18, C20, C43, C45): the one source `gaps`, `incidents` and `race-moment`
// read, so they agree on what was neutralised. A neutralisation is a span of a session-phase sub-machine: the race's
// `neutralised` (SC, VSC) and `suspended` (red flag) spans, and the `suspended` spans of qualifying and practice. The
// owner of the neutralisation kind (SP4.3c O6): the open one, the last one (confirmed only), whether it is ending, and
// the time-loss exclusion every caller of `timeLossEvents` passes; no unit matches these span kinds itself.
import type { CarId, MachineId, NeutralisedDetail, OpenSpan, Span } from '@pitwall/domain';
import { coverageOf, spansOverlapping, type Coverage, type DeepReadonly, type EngineView } from '@pitwall/engine/readers';
import type { TimeLossExcluded } from './time-loss/index.ts';

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
 * The neutralisations (as `neutralisedSpans` counts them) covering at least one frame of `[fromFrame, toFrame)`, closed
 * of the projection and open of the situation, by the projection module's span-range query (C26), per session-phase
 * sub-machine in `NEUTRALISATION_MACHINES`' order, the closed ones before the open one.
 */
export function neutralisationsOverlapping(
  source: { history: Pick<EngineView['history'], 'spans'>; situation?: Pick<EngineView['situation'], 'byMachine'> },
  fromFrame: number,
  toFrame: number,
): ReadonlyArray<Neutralisation> {
  return NEUTRALISATION_MACHINES.flatMap((machine) => spansOverlapping(source, fromFrame, toFrame, machine).filter((s) => isNeutralisation(machine, s)));
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

/** The session-phase sub-machine of each weekend phase (C14, C17): the one whose spans can be a neutralisation then. */
const PHASE_MACHINE: Readonly<Record<string, MachineId>> = {
  race: 'session-phase-race',
  qualifying: 'session-phase-qualifying',
  practice: 'session-phase-practice',
};

/** The session-phase sub-machine that runs in the situation's weekend phase; none while it is pending or `none` (C14). */
const phaseMachineOf = (situation: EngineView['situation']): MachineId | undefined => PHASE_MACHINE[situation.weekendPhase.kind];

/**
 * The open neutralisation of the situation (C20) and its kind, from the session-phase sub-machine of its weekend phase
 * (C14); `null` when none is open. One pending its confirmation is one, from its earliest reliable signal (C18).
 */
export function openNeutralisation(view: Pick<EngineView, 'situation'>): { kind: NeutralisationKind; span: DeepReadonly<OpenSpan> } | null {
  const machine = phaseMachineOf(view.situation);
  if (machine === undefined) return null;
  const span = (view.situation.byMachine[machine] ?? []).find((s) => isNeutralisation(machine, s));
  return span === undefined ? null : { kind: neutralisationKind(span), span };
}

/**
 * The newest closed neutralisation of the projection (C20), from the session-phase sub-machine of the situation's
 * weekend phase (C14), of one of `kinds` (every kind by default); confirmed only: a span closed with `confirmed: false`
 * never was one (C18). The open one is `openNeutralisation`'s. `null` when none.
 */
export function lastNeutralisation(
  projection: Pick<EngineView['history'], 'spans'>,
  situation: EngineView['situation'],
  kinds?: readonly NeutralisationKind[],
): DeepReadonly<Span> | null {
  const machine = phaseMachineOf(situation);
  if (machine === undefined) return null;
  const spans = projection.spans[machine] ?? [];
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i] as DeepReadonly<Span>;
    if (span.confirmed && isNeutralisation(machine, span) && (kinds === undefined || kinds.includes(neutralisationKind(span)))) return span;
  }
  return null;
}

/**
 * Whether a neutralisation is ending: an SC or VSC that has reached any stage past `deployed` (stages come in their
 * order, so this is `returning` reached, also when a stage was missed). A suspension never is.
 */
export const isEnding = (span: Neutralisation): boolean =>
  span.kind === 'neutralised' && (span.detail as NeutralisedDetail).stages.some((s) => s.stage !== 'deployed');

/** The car-location sub-machine, and its kinds during which a car's mini-sectors are no time loss: a pit visit, a garage spell. */
const CAR_LOCATION: MachineId = 'car-location';
const NO_TIME_LOSS_LOCATIONS: readonly string[] = ['pitLane', 'garage'];

/**
 * What `timeLossExcludedOf` reads in a race (C41): the race's session-phase spans and car-location. In another weekend
 * phase it reads that phase's session-phase sub-machine instead (`NEUTRALISATION_READS`).
 */
export const TIME_LOSS_EXCLUSION_READS = ['spans:session-phase-race', 'spans:car-location'] as const;

/** Where `timeLossExcludedOf` finds its spans: the closed ones (a projection's) and, for a running session, the open ones. */
type ExclusionSource = { history: Pick<EngineView['history'], 'spans'>; situation?: EngineView['situation'] };

/**
 * The one time-loss exclusion (C26, C43) every caller of `timeLossEvents` passes: a car's mini-sector from frame `from`
 * to frame `to` is excluded when a neutralisation (`isNeutralisation`: a closed one confirmed, an open one also pending
 * its confirmation) or the car's pit visit or garage spell covers any of its frames `[from, to)` (frame `from` for an
 * empty one), by the projection module's coverage query (`coverageOf`, built once per call) over those spans, closed and open. With
 * a situation, the neutralisations are those of the session-phase sub-machine of its weekend phase (C14; none while it
 * is pending); without one (a fold over closed spans alone, C31.2), those of every session-phase sub-machine of the
 * source.
 */
export function timeLossExcludedOf(view: ExclusionSource): TimeLossExcluded {
  const phase = view.situation === undefined ? NEUTRALISATION_MACHINES : [phaseMachineOf(view.situation)].filter((m) => m !== undefined);
  const neutralised = phase.map((machine) => coverageOf(view, machine, { keep: (s) => isNeutralisation(machine, s) }));
  const cars = new Set<CarId>();
  for (const s of view.history.spans[CAR_LOCATION] ?? []) if (s.carId !== undefined) cars.add(s.carId);
  for (const s of view.situation?.byMachine[CAR_LOCATION] ?? []) if (s.carId !== undefined) cars.add(s.carId);
  const keep = (s: { kind: string }) => NO_TIME_LOSS_LOCATIONS.includes(s.kind);
  const away = new Map<CarId, Coverage>();
  for (const carId of cars) away.set(carId, coverageOf(view, CAR_LOCATION, { carId, keep }));
  return (carId, from, to) => {
    const end = Math.max(to, from + 1);
    for (const covered of neutralised) if (covered(from, end)) return true;
    return away.get(carId)?.(from, end) ?? false;
  };
}

// `leaderLapAt` moved to its owner, `gaps` (SP4.3c Task 6, O10); re-exported only for the tests that import it from here.
export { leaderLapAt } from '../gaps/leader.ts';
