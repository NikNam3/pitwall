import type { FlagPhase, OpenSessionPhase, ScPhase } from '@pitwall/domain';
import type { EngineState } from '../state/engine-state.ts';
import type { StepOutput } from '../step/types.ts';

type OpenFlagPhase = Omit<FlagPhase, 'end' | 'endLeaderLap'>;

/** The flag phase a session phase stands for: a neutralisation by its car, a suspension as red; none for the others. */
const flagKindOf = (phase: OpenSessionPhase): FlagPhase['kind'] | undefined => {
  if (phase.detail?.kind === 'neutralised') return phase.detail.car;
  return phase.kind === 'suspended' ? 'red' : undefined;
};

const scPhasesOf = (phase: OpenSessionPhase): ScPhase[] =>
  phase.detail?.kind === 'neutralised' ? phase.detail.stages.map(({ stage, at }) => ({ phase: stage, at })) : [];

const openFlagPhaseOf = (phase: OpenSessionPhase): OpenFlagPhase | undefined => {
  const kind = flagKindOf(phase);
  return kind && { kind, start: phase.start, startLeaderLap: phase.startLeaderLap, scPhases: scPhasesOf(phase) };
};

/** Whether the open flag phase already stands for the session phase in progress, stages included. */
const mirrors = (flag: OpenFlagPhase | undefined, phase: OpenSessionPhase): boolean => {
  const kind = flagKindOf(phase);
  if (flag === undefined || kind === undefined) return flag === undefined && kind === undefined;
  const stages = phase.detail?.kind === 'neutralised' ? phase.detail.stages.length : 0;
  return flag.kind === kind && flag.start === phase.start && flag.scPhases.length === stages;
};

/**
 * Safety car, virtual safety car and red flag phases, as the situation tracker's neutralised and suspended spans give
 * them (no signal of their own; plan Task 6 moves their readers to the session phases). A span the tracker closed is
 * appended; the phase in progress is the view's `activeFlagPhase`. Appending, opening, closing and a new SC stage each
 * tag `flagPhases`.
 */
export const applyFlagPhases = (state: EngineState, out: StepOutput): void => {
  // Legacy lists (`LegacyList`): written in the log directly until Task 19 removes flag phases.
  const { sessionPhases, flagPhases } = state.log;
  const recorded = flagPhases.length;
  let mirrored = 0;
  for (const span of sessionPhases) {
    const kind = flagKindOf(span);
    if (kind === undefined || mirrored++ < recorded) continue;
    flagPhases.push({ kind, start: span.start, end: span.end, startLeaderLap: span.startLeaderLap, endLeaderLap: span.endLeaderLap, scPhases: scPhasesOf(span) });
  }
  const { session } = state.open.situations;
  const changedOpen = !mirrors(state.open.flagPhase, session);
  if (changedOpen) state.open.flagPhase = openFlagPhaseOf(session);
  if (flagPhases.length > recorded || changedOpen) out.changed.add('flagPhases');
};
