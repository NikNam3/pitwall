// The session phase machine (spec docs/superpowers/specs/2026-10-30-situations-design.md 3.1, 3.2): which signal opens
// and closes each phase, the confirmation of a neutralisation, the session's ends, joining a session in progress, and
// the formation lap discarded at lights out. Facts: .superpowers/sdd/2026-10-30-storage-c-39-40/situations-inventory.md
// section 1 and t1-diagnosis.md.
import {
  known,
  unknown,
  type NeutralisedStage,
  type OpenSessionPhase,
  type SessionFlag,
  type SessionPhaseKind,
  type SessionPhaseSpan,
  type SessionTime,
} from '@pitwall/domain';
import type { EventDetails, EventDetailsOf } from '@pitwall/protocol';
import type { Frame } from '../../frame/frame.ts';
import type { EngineState, History, HistoryLengths } from '../../state/engine-state.ts';
import { isActiveCar, slotsInUse } from '../../step/identity.ts';
import type { StepOutput } from '../../step/types.ts';
import { historyLengths } from '../delta.ts';
import { restartLap } from '../laps.ts';

type NeutralisingCar = 'SC' | 'VSC';

const CAR_OF_FLAG: Partial<Record<SessionFlag, NeutralisingCar>> = { sc: 'SC', vsc: 'VSC' };
/** Indexed by the SCAR `safetyCarType`: 0 is none (its resume duplicates the car's own), 3 the formation lap. */
const CAR_OF_SC_TYPE: ReadonlyArray<NeutralisingCar | undefined> = [undefined, 'SC', 'VSC'];
const FORMATION_SC_TYPE = 3;
/** Indexed by the SCAR `eventType`. */
const STAGES: readonly NeutralisedStage[] = ['deployed', 'returning', 'returned', 'resume'];

/**
 * Session packets after a deployment that may still confirm it with the safety car status; the status follows the SCAR
 * by one packet, 0.5 to 1.3 s (spec 3.1; inventory 1.4).
 */
const CONFIRM_WITHIN_SESSION_PACKETS = 2;
/** A Session packet this soon after a deployment left the game before its status could show it (observed: 29 ms). */
const SENT_WITH_DEPLOYMENT_MS = 100;
/**
 * A race joined with a lap timer above this is under way: on the grid the timers read 0, or 510 ms for the cars past
 * the line in raceZandvoortOnline's hold (t1-diagnosis.md S3).
 */
const UNDER_WAY_LAP_TIME_MS = 1000;
/** What the formation discard cuts back; the phases, flag phases and pauses stay (spec 3.2). */
const DISCARDED = ['laps', 'stints', 'pitStops', 'events', 'miniSectors'] as const satisfies ReadonlyArray<keyof History>;

/** The lap of the car in first place; 0 when no car in the session holds it. */
export const leaderLap = (state: EngineState): number => {
  const slots = slotsInUse(state);
  return state.cars.find((car) => car.timing.position === 1 && isActiveCar(car.id, slots, car.timing.resultStatus))?.timing.lap ?? 0;
};

const isRace = (state: EngineState): boolean => state.session.kind === 'race';

const phase = (state: EngineState, kind: SessionPhaseKind, at: SessionTime): OpenSessionPhase => ({ kind, start: at, startLeaderLap: leaderLap(state) });

/** Racing in a race, running in the other sessions: the phase a neutralisation gives back to. */
const green = (state: EngineState, at: SessionTime): OpenSessionPhase => phase(state, isRace(state) ? 'racing' : 'running', at);

const neutralised = (state: EngineState, car: NeutralisingCar, at: SessionTime, stages: NeutralisedStage[]): OpenSessionPhase => ({
  ...phase(state, 'neutralised', at),
  detail: { kind: 'neutralised', car, stages: stages.map((stage) => ({ stage, at })) },
});

/** The car of a neutralisation in progress, if one is. */
const carOf = (open: OpenSessionPhase): NeutralisingCar | undefined => (open.detail?.kind === 'neutralised' ? open.detail.car : undefined);

/** The session's end phases open nothing new. */
const isOver = (open: OpenSessionPhase): boolean => open.kind === 'finished' || open.kind === 'postSession';

/** `open` closed at `at`; a suspension closed by its restart records how it restarted. */
const closed = (state: EngineState, open: OpenSessionPhase, at: SessionTime, restart?: 'standing' | 'rolling'): SessionPhaseSpan => ({
  ...open,
  ...(restart && open.kind === 'suspended' && { detail: { kind: 'suspended', restart: known(restart, at) } }),
  end: at,
  endLeaderLap: leaderLap(state),
});

/** An unconfirmed neutralisation becomes a confirmed one: the span it closed goes to the history. */
const confirm = (state: EngineState): void => {
  const book = state.open.phaseBook;
  if (!book.unconfirmed) return;
  state.history.sessionPhases.push(book.unconfirmed.closed);
  book.unconfirmed = undefined;
};

/** An unconfirmed neutralisation never happened: the phase it replaced goes on as before. */
const drop = (state: EngineState): void => {
  const book = state.open.phaseBook;
  if (!book.unconfirmed) return;
  state.open.situations.session = book.unconfirmed.replaced;
  book.unconfirmed = undefined;
};

/** Closes the phase in progress where `next` opens and opens `next`. */
const enter = (state: EngineState, next: OpenSessionPhase, restart?: 'standing' | 'rolling'): void => {
  confirm(state);
  const { situations } = state.open;
  state.history.sessionPhases.push(closed(state, situations.session, next.start, restart));
  situations.session = next;
};

/** The open neutralisation with one more stage. */
const addStage = (state: EngineState, stage: NeutralisedStage, at: SessionTime): void => {
  const { situations } = state.open;
  const { detail } = situations.session;
  if (detail?.kind !== 'neutralised') return;
  situations.session = { ...situations.session, detail: { ...detail, stages: [...detail.stages, { stage, at }] } };
};

/**
 * A SCAR deployment opens the neutralisation at once, unconfirmed until the safety car status shows it (spec 3.1). An SC
 * deployed under a VSC closes the VSC; one deployed in a suspension is the rolling restart.
 */
const deploy = (state: EngineState, car: NeutralisingCar, at: SessionTime): void => {
  const { situations, phaseBook } = state.open;
  if (isOver(situations.session) || carOf(situations.session) === car) return;
  // An earlier deployment still waiting stands: this one closes it.
  confirm(state);
  const replaced = situations.session;
  phaseBook.unconfirmed = { closed: closed(state, replaced, at, 'rolling'), replaced, sessionPackets: 0 };
  situations.session = neutralised(state, car, at, ['deployed']);
};

/**
 * A Session packet after the deployment: its status confirms the neutralisation, or counts against it when it shows
 * none. A packet that still shows the earlier neutralisation (a VSC upgraded to an SC: raceZandvoortUidReuse at 924.231
 * s, the SC status 1.3 s later) or that came right after the deployment (built before it: inventory MiR, 29 ms after the
 * VSC's SCAR at 203.137 s) does not count.
 */
const countConfirmation = (state: EngineState, frame: Frame): void => {
  const pending = state.open.phaseBook.unconfirmed;
  if (!pending || !frame.session) return;
  const shown = CAR_OF_FLAG[state.session.flag];
  if (shown === carOf(state.open.situations.session)) return confirm(state);
  if (shown !== undefined || frame.sessionTime - pending.closed.end < SENT_WITH_DEPLOYMENT_MS) return;
  pending.sessionPackets++;
  if (pending.sessionPackets >= CONFIRM_WITHIN_SESSION_PACKETS) drop(state);
};

/**
 * The formation phase, from the grid (spec 3.1). It notes the history lengths it opens at: lights out cuts the history
 * back to them (3.2).
 */
const openFormation = (state: EngineState, at: SessionTime): void => {
  if (!isRace(state) || state.open.situations.session.kind !== 'preStart') return;
  state.open.phaseBook.formationFrom = historyLengths(state.history);
  enter(state, phase(state, 'formation', at));
};

/**
 * The first start light, from the grid, the formation lap or a red flag (a standing restart). It ends the formation
 * phase: as the game reset the session time at the formation lap's end, that span ends on the race clock, below its
 * start.
 */
const startLights = (state: EngineState, at: SessionTime): void => {
  const { kind } = state.open.situations.session;
  if (!isRace(state) || (kind !== 'preStart' && kind !== 'formation' && kind !== 'suspended')) return;
  if (kind !== 'suspended') state.open.phaseBook.startFrom = historyLengths(state.history);
  enter(state, phase(state, 'startLights', at), 'standing');
};

/** Rebuilds the per-car lap index from the laps left in the history. */
const reindexLaps = (state: EngineState): void => {
  const { history, open } = state;
  open.lapIndex = open.lapIndex.map(() => ({}));
  history.laps.forEach((lap, i) => {
    const index = open.lapIndex[lap.carId];
    if (!index) return;
    const slot = (index[lap.lapNumber] ??= { confirmed: false });
    if (lap.status === 'confirmed') slot.confirmed = true;
    else slot.provisional = i;
  });
};

/**
 * Lights out after a formation lap discards what the formation recorded (spec 3.2): the history goes back to its
 * lengths when the formation opened, but for the start lights; the phases, flag phases and pauses stay. Mini-sector
 * cursors start over and open pit visits restart at lights out.
 */
const discardFormation = (state: EngineState, from: HistoryLengths, at: SessionTime): void => {
  const { history, open } = state;
  const lights = history.events.slice(from.events).filter((e) => e.kind === 'startLights');
  for (const key of DISCARDED) history[key].splice(from[key]);
  history.events.push(...lights);
  reindexLaps(state);
  open.miniSectors.fill(undefined);
  open.pitVisits = open.pitVisits.map((visit, id) =>
    visit && { ...visit, lap: state.cars[id]?.timing.lap ?? visit.lap, entry: at, penaltyServed: false, pitLaneTimeMs: 0, stationaryTimeMs: 0 },
  );
};

/**
 * Lights out ends the start lights and opens racing; the race's first lights out is the race start. There every car's
 * lap starts over from its start, the formation lap (if any) is discarded, and the settling window opens (3.3). A
 * restart after a red flag is no race start.
 */
const lightsOut = (state: EngineState, frame: Frame, at: SessionTime, out: StepOutput): void => {
  const phaseFrom = state.history.sessionPhases.length;
  enter(state, phase(state, 'racing', at));
  const book = state.open.phaseBook;
  const start = book.formationFrom ?? book.startFrom;
  if (!start) return;
  if (book.formationFrom) {
    discardFormation(state, book.formationFrom, at);
    out.rewritten = true;
  }
  const slots = slotsInUse(state);
  for (const car of state.cars) {
    if (isActiveCar(car.id, slots, car.timing.resultStatus) && car.updatedAt.lapData !== undefined) restartLap(state, car, at);
  }
  // The start's entries: the start lights (all that is left from before lights out) and everything from here on.
  book.lightsOut = { frameId: frame.frameId, from: { ...historyLengths(state.history), events: start.events }, phaseFrom };
  book.formationFrom = undefined;
  book.startFrom = undefined;
};

const applySafetyCarEvent = (state: EngineState, details: EventDetailsOf<'SCAR'>, at: SessionTime): void => {
  if (details.safetyCarType === FORMATION_SC_TYPE && details.eventType === 0) return openFormation(state, at);
  const car = CAR_OF_SC_TYPE[details.safetyCarType];
  const stage = STAGES[details.eventType];
  if (!car || !stage) return;
  if (stage === 'deployed') return deploy(state, car, at);
  if (carOf(state.open.situations.session) !== car) return;
  addStage(state, stage, at);
  // A resume sent twice (types 1 and 0) closes once: the second finds no neutralisation open.
  if (stage === 'resume') enter(state, green(state, at));
};

/** A red flag suspends the session until its restart (not yet seen in a recording: spec principle 4). */
const suspend = (state: EngineState, at: SessionTime): void => {
  const open = state.open.situations.session;
  if (isOver(open) || open.kind === 'suspended') return;
  enter(state, { ...phase(state, 'suspended', at), detail: { kind: 'suspended', restart: unknown('notReceived') } });
};

/** The race winner or the chequered flag, whichever first, finishes a race under way. */
const finish = (state: EngineState, at: SessionTime): void => {
  const { kind } = state.open.situations.session;
  if (isRace(state) && (kind === 'racing' || kind === 'neutralised' || kind === 'suspended')) enter(state, phase(state, 'finished', at));
};

/** Every car in the session has finished: time over in practice or qualifying (a player who left retires instead). */
const everyCarFinished = (state: EngineState): boolean => {
  const slots = slotsInUse(state);
  const inSession = state.cars.filter((car) => isActiveCar(car.id, slots, car.timing.resultStatus));
  return inSession.length > 0 && inSession.every((car) => car.timing.resultStatus === 'finished');
};

/** SEND ends the session as it stands: a neutralisation not yet confirmed is kept. Practice and qualifying finish on time over. */
const endSession = (state: EngineState, at: SessionTime): void => {
  const open = state.open.situations.session;
  if (open.kind === 'postSession') return;
  if (!isRace(state) && !isOver(open) && everyCarFinished(state)) enter(state, phase(state, 'finished', at));
  enter(state, phase(state, 'postSession', at));
};

/**
 * The game simulated the rest of the session (a forward jump of the session time, or a final classification without
 * SEND): what it never confirmed did not happen, and the post-session opens at `at`.
 */
export const enterPostSession = (state: EngineState, at: SessionTime): void => {
  if (state.open.situations.session.kind === 'postSession') return;
  drop(state);
  enter(state, phase(state, 'postSession', at));
};

const applyEvent = (state: EngineState, frame: Frame, details: EventDetails, out: StepOutput): void => {
  const at = frame.sessionTime;
  switch (details.code) {
    case 'SCAR':
      return applySafetyCarEvent(state, details, at);
    case 'STLG':
      return startLights(state, at);
    case 'LGOT':
      // Lights out only ends the start lights: one before any start light (the formation lap's own) is none.
      if (state.open.situations.session.kind === 'startLights') lightsOut(state, frame, at, out);
      return;
    case 'RDFL':
      return suspend(state, at);
    case 'RCWN':
    case 'CHQF':
      return finish(state, at);
    case 'SEND':
      return endSession(state, at);
    default:
      return;
  }
};

/**
 * A change of the safety car status: into the formation lap opens it; into SC or VSC confirms the neutralisation it
 * shows, or opens one from any phase but the session's end (no SCAR: a late join, or a game that sent none), and out
 * of it closes the confirmed one.
 */
const applyStatus = (state: EngineState, at: SessionTime): void => {
  const { flag } = state.session;
  const last = state.open.lastFlag;
  state.open.lastFlag = flag;
  if (flag === last) return;
  if (flag === 'formation') return openFormation(state, at);
  const open = state.open.situations.session;
  const entered = CAR_OF_FLAG[flag];
  if (entered) {
    if (carOf(open) === entered) return confirm(state);
    if (!isOver(open)) enter(state, neutralised(state, entered, at, []), 'rolling');
    return;
  }
  const left = CAR_OF_FLAG[last];
  if (left && carOf(open) === left && !state.open.phaseBook.unconfirmed) enter(state, green(state, at));
};

/** The race is under way on the frame the engine joins it: the leader past lap 1, or a lap timer running. */
const raceUnderWay = (state: EngineState): boolean => {
  const slots = slotsInUse(state);
  return (
    leaderLap(state) > 1 ||
    state.cars.some((car) => isActiveCar(car.id, slots, car.timing.resultStatus) && car.timing.currentLapTimeMs > UNDER_WAY_LAP_TIME_MS)
  );
};

/**
 * The phase on the session's first frame (Review Focus 2). A session joined in progress opens its current phase there,
 * marked `joinedAt`; otherwise the grid (`preStart`), or `running` in a time trial.
 */
export const joinSession = (state: EngineState, frame: Frame): void => {
  const at = frame.sessionTime;
  const { kind, flag, timeLeftMs, durationMs } = state.session;
  const car = CAR_OF_FLAG[flag];
  const joined = (open: OpenSessionPhase): OpenSessionPhase => ({ ...open, joinedAt: true });
  state.open.lastFlag = flag;
  let open: OpenSessionPhase;
  if (kind === 'timeTrial') open = phase(state, 'running', at);
  else if (car) open = joined(neutralised(state, car, at, []));
  else if (kind === 'race' && flag === 'formation') {
    state.open.phaseBook.formationFrom = historyLengths(state.history);
    open = joined(phase(state, 'formation', at));
  } else if (kind === 'race') open = raceUnderWay(state) ? joined(phase(state, 'racing', at)) : phase(state, 'preStart', at);
  else open = timeLeftMs < durationMs ? joined(phase(state, 'running', at)) : phase(state, 'preStart', at);
  state.open.situations.session = open;
};

/**
 * Applies the frame's phase signals, in order: the confirmation of a waiting neutralisation by this frame's Session
 * packet, the events (so a SCAR and the status change of the same frame make one neutralisation), the safety car
 * status, a final classification, and the clock starting in practice and qualifying.
 */
export const applyPhaseSignals = (state: EngineState, frame: Frame, out: StepOutput): void => {
  const at = frame.sessionTime;
  countConfirmation(state, frame);
  for (const { details } of frame.events) applyEvent(state, frame, details, out);
  applyStatus(state, at);
  if (frame.finalClassification) enterPostSession(state, at);
  const { kind } = state.open.situations.session;
  if (kind === 'preStart' && !isRace(state) && at > state.sessionTime) enter(state, green(state, at));
};
