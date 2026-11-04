// Views with the situation the rate and car units read (contract C14, C20, C41, C44), and those units through their
// guarded view: a test builds the open spans of the machines a unit's behaviour table covers (the weekend phase, each
// car's status, and whatever else it names), and runs the unit on a view that throws on any read it does not declare.
import { carId, unknown, type OpenSpan, type WeekendPhase } from '@pitwall/domain';
import type { EngineView, IncrementalCalculator, QuickCalculator } from '@pitwall/engine/readers';
import { guarded } from '../../engine/test/support/scheduler.ts';
import { engineView } from '../../../test-support/builders/index.ts';

/** The weekend phases a test runs a unit in (C14); `NONE` is a time trial or an unknown session type. */
export const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };
export const PRACTICE: WeekendPhase = { kind: 'practice', format: 'practice', segment: 2 };
export const QUALIFYING: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 1 };
export const NONE: WeekendPhase = { kind: 'none' };

/** An open span of `machine` of `kind` as `view.situation` holds it (C20): since `start` (frame 1), of car `car` when given. */
export function openSpan(machine: string, kind: string, o: { car?: number; start?: number; detail?: unknown } = {}): OpenSpan {
  return {
    machine,
    id: 0,
    kind,
    start: o.start ?? 0,
    confirmed: true,
    detail: o.detail ?? (machine === 'car-status' && kind === 'retired' ? { cause: unknown('notReceived') } : undefined),
    startFrame: 1,
    ...(o.car !== undefined && { carId: carId(o.car) }),
  };
}

/** The weekend-phase span that stands for `phase` (C14): its kind, with its format and segment as the detail. */
const phaseSpan = (phase: WeekendPhase): OpenSpan[] => {
  if (phase.kind === 'pending') return [];
  const { kind, ...detail } = phase;
  return [openSpan('weekend-phase', kind, { detail })];
};

/** What the situation of a `situatedView` holds besides the view's own parts. */
export type Situated = {
  /** The weekend phase (default `RACE`): `view.situation.weekendPhase` and its open `weekend-phase` span (none while `pending`). */
  phase?: WeekendPhase;
  /** A car's car-status kind by car id; every car of `cars` not named here is `competing`; a named id without a car gets its span too. */
  status?: Record<number, string>;
  /** Further open spans (car activity, car location ...), as `openSpan` builds them. */
  spans?: OpenSpan[];
};

/**
 * `engineView(o)` whose situation (C20) holds the weekend phase's span, one car-status span per car (`competing` unless
 * `status` says otherwise) and `spans`, by machine. A slot with no car-status span is not in the session (C17).
 */
export function situatedView(o: Parameters<typeof engineView>[0] & Situated = {}): EngineView {
  const { phase = RACE, status = {}, spans = [], ...rest } = o;
  const ids = [...new Set([...(rest.cars ?? []).map((c) => c.id as number), ...Object.keys(status).map(Number)])].sort((a, b) => a - b);
  const all = [...phaseSpan(phase), ...ids.map((id) => openSpan('car-status', status[id] ?? 'competing', { car: id })), ...spans];
  const byMachine: Record<string, OpenSpan[]> = {};
  for (const span of all) (byMachine[span.machine] ??= []).push(span);
  return engineView({ ...rest, situation: { weekendPhase: phase, byMachine } });
}

/** A quick unit that sees every view through its guarded view (C41): a read it does not declare throws. */
export const guardedQuick = <O>(calc: QuickCalculator<O>): QuickCalculator<O> => guarded(calc as never) as unknown as QuickCalculator<O>;

/** An incremental unit that inits and folds through its guarded view (C41): a read it does not declare throws. */
export const guardedIncremental = <A, O>(calc: IncrementalCalculator<A, O>): IncrementalCalculator<A, O> =>
  guarded(calc as never) as unknown as IncrementalCalculator<A, O>;
