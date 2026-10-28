import type { FlagPhase, ScPhase, SessionFlag, SessionTime } from '@pitwall/domain';
import type { EventDetails, EventDetailsOf } from '@pitwall/protocol';
import type { EngineState } from '../state/engine-state.ts';
import { isActiveCar } from '../step/identity.ts';
import type { SubStep } from '../step/types.ts';

type NeutralisedKind = Exclude<FlagPhase['kind'], 'red'>;

const KIND_OF_FLAG: Partial<Record<SessionFlag, NeutralisedKind>> = { sc: 'SC', vsc: 'VSC' };
/** Indexed by the SCAR `safetyCarType`; 0 (none) and 3 (formation lap) are no phase. */
const KIND_OF_SC_TYPE: ReadonlyArray<NeutralisedKind | undefined> = [undefined, 'SC', 'VSC'];
/** Indexed by the SCAR `eventType`. */
const SC_PHASES: ReadonlyArray<ScPhase['phase']> = ['deployed', 'returning', 'returned', 'resume'];

/** The lap of the car in first place; 0 when no active car holds it. */
const leaderLap = (state: EngineState): number =>
  state.cars.find(
    (car) => car.timing.position === 1 && isActiveCar(car.id, state.session.numActiveCars, car.timing.resultStatus),
  )?.timing.lap ?? 0;

const closePhase = (state: EngineState, at: SessionTime): void => {
  const phase = state.open.flagPhase;
  if (!phase) return;
  state.history.flagPhases.push({ ...phase, end: at, endLeaderLap: leaderLap(state) });
  state.open.flagPhase = undefined;
};

/** Opens a phase of `kind` unless one is open already; a phase of another kind ends at the same time. */
const openPhase = (state: EngineState, kind: FlagPhase['kind'], at: SessionTime): void => {
  if (state.open.flagPhase?.kind === kind) return;
  closePhase(state, at);
  state.open.flagPhase = { kind, start: at, startLeaderLap: leaderLap(state), scPhases: [] };
};

const applySafetyCarEvent = (state: EngineState, details: EventDetailsOf<'SCAR'>, at: SessionTime): void => {
  const kind = KIND_OF_SC_TYPE[details.safetyCarType];
  const phase = SC_PHASES[details.eventType];
  if (!kind || !phase) return;
  if (phase === 'deployed') openPhase(state, kind, at);
  const open = state.open.flagPhase;
  if (open?.kind !== kind) return;
  open.scPhases.push({ phase, at });
  if (phase === 'resume') closePhase(state, at);
};

const applyEvent = (state: EngineState, details: EventDetails, at: SessionTime): void => {
  switch (details.code) {
    case 'SCAR':
      applySafetyCarEvent(state, details, at);
      break;
    case 'RDFL':
      openPhase(state, 'red', at);
      break;
    case 'LGOT':
      if (state.open.flagPhase?.kind === 'red') closePhase(state, at);
      break;
    case 'SEND':
      closePhase(state, at);
      break;
    default:
      break;
  }
};

/** A change of the safety car status into SC or VSC opens a phase and out of it closes it; a red flag has no status. */
const applyFlagChange = (state: EngineState, at: SessionTime): void => {
  const { flag } = state.session;
  const { lastFlag } = state.open;
  state.open.lastFlag = flag;
  if (flag === lastFlag) return;
  const left = KIND_OF_FLAG[lastFlag];
  if (left && state.open.flagPhase?.kind === left) closePhase(state, at);
  // A red phase ends here too: the restart behind the safety car.
  const entered = KIND_OF_FLAG[flag];
  if (entered) openPhase(state, entered, at);
};

/**
 * Safety car, virtual safety car and red flag phases. Events come first, so a `SCAR` and the status change of the
 * same frame make one phase. A phase is appended when it closes (spec correction 7 for the red flag).
 */
export const applyFlagPhases: SubStep = (state, frame, out) => {
  const before = state.history.flagPhases.length;
  const at = frame.sessionTime;
  for (const { details } of frame.events) applyEvent(state, details, at);
  applyFlagChange(state, at);
  if (state.history.flagPhases.length > before) out.changed.add('flagPhases');
};
