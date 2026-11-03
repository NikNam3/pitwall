// The flag phases (legacy list `flagPhases`, until Task 19): safety car, virtual safety car and red flag phases, a mirror
// of the race's session-phase spans (`neutralised`, `suspended`) for the readers that still read them. No signal of
// their own: a step-3 module, it reads the projection's closed spans, the machine's situation, the live state and its
// own open state (C10, C20, C28).
import type { FlagPhase, NeutralisedDetail, OpenSpan, ScPhase } from '@pitwall/domain';
import type { Situation } from '../situations/situation.ts';
import type { EngineState } from '../state/engine-state.ts';
import { isActiveCar, slotsInUse } from '../step/active-cars.ts';
import type { StepOutput } from '../step/types.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';

type OpenFlagPhase = Omit<FlagPhase, 'end' | 'endLeaderLap'>;
type PhaseSpan = DeepReadonly<OpenSpan>;

/** The sub-machine whose spans the flag phases mirror. */
const RACE_PHASES = 'session-phase-race';

/** The lap of the car in first place; 0 when no car in the session holds it. */
const leaderLap = (state: DeepReadonly<EngineState>): number => {
  const slots = slotsInUse(state);
  return state.cars.find((car) => car.timing.position === 1 && isActiveCar(car.id, slots, car.timing.resultStatus))?.timing.lap ?? 0;
};

/** The flag phase a span stands for: a neutralisation by its car, a suspension as red; none for the other kinds. */
const flagKindOf = (span: PhaseSpan | undefined): FlagPhase['kind'] | undefined => {
  if (span?.kind === 'neutralised') return (span.detail as DeepReadonly<NeutralisedDetail>).car;
  return span?.kind === 'suspended' ? 'red' : undefined;
};

const scPhasesOf = (span: PhaseSpan): ScPhase[] =>
  span.kind === 'neutralised' ? (span.detail as DeepReadonly<NeutralisedDetail>).stages.map(({ stage, at }) => ({ phase: stage, at })) : [];

/** The id of the flag phases' own open state in `open.recorders` (a step-3 module's, C10, C11). */
const OWN = 'flagPhases';

/** The flag phases' own open state: the race's span in progress that stands for a flag phase (its kind and start) and the leader's lap on the frame it opened. */
type FlagsOwn = { opened?: { kind: FlagPhase['kind']; start: number; leaderLap: number } | undefined };

/** The leader's lap where `span` opened: as noted on that frame, or now when it opened on this one. */
const startLapOf = (own: FlagsOwn, span: PhaseSpan, now: number): number =>
  own.opened !== undefined && own.opened.kind === flagKindOf(span) && own.opened.start === span.start ? own.opened.leaderLap : now;

/**
 * Appends a flag phase for every confirmed `neutralised` or `suspended` span of `session-phase-race` the projection
 * took in on this frame (closed on it, C26), with the leader's lap on the frames it opened and closed; a span never
 * confirmed (C18) is none. The span in progress is the open flag phase, the view's `activeFlagPhase`, from its opening
 * on (a SCAR deployment opens it early, while its confirmation waits). Appending, opening, closing and a new SC stage
 * each tag `flagPhases`. Returns whether it appended.
 */
export const applyFlagPhases = (state: EngineState, situation: Situation, out: StepOutput): boolean => {
  const lap = leaderLap(state);
  const own = (state.open.recorders[OWN] ?? {}) as FlagsOwn;
  const spans = state.history.spans[RACE_PHASES] ?? [];
  let appended = false;
  let first = spans.length;
  while (first > 0 && spans[first - 1]?.endFrame === state.frameNumber) first--;
  for (const span of spans.slice(first)) {
    const kind = flagKindOf(span);
    if (kind === undefined || !span.confirmed) continue;
    // Legacy list (`LegacyList`): written in the log directly until Task 19 removes flag phases.
    state.log.flagPhases.push({ kind, start: span.start, end: span.end, startLeaderLap: startLapOf(own, span, lap), endLeaderLap: lap, scPhases: scPhasesOf(span) });
    appended = true;
  }
  const open = situation.byMachine[RACE_PHASES]?.[0];
  const kind = flagKindOf(open);
  const opened = open === undefined || kind === undefined ? undefined : { kind, start: open.start, leaderLap: startLapOf(own, open, lap) };
  state.open.recorders[OWN] = { opened } satisfies FlagsOwn;
  const next: OpenFlagPhase | undefined =
    open === undefined || opened === undefined ? undefined : { kind: opened.kind, start: opened.start, startLeaderLap: opened.leaderLap, scPhases: scPhasesOf(open) };
  const before = state.open.flagPhase;
  const changedOpen = before?.kind !== next?.kind || before?.start !== next?.start || before?.scPhases.length !== next?.scPhases.length;
  if (changedOpen) state.open.flagPhase = next;
  if (appended || changedOpen) out.changed.add('flagPhases');
  return appended;
};
