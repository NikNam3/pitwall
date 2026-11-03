// The session phase machine (spec docs/history/specs/2026-10-30-situations-design.md 3.1, 3.2): which signal opens
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
import type { Log } from '../../log/types.ts';
import type { EngineState, TrackerLengths } from '../../state/engine-state.ts';
import { endLapVisits, lapsRecorder, reindexLaps, restartLap } from '../../recorders/laps.ts';
import { restartMiniSectors, miniSectorsRecorder } from '../../recorders/mini-sectors.ts';
import { ownStateOf } from '../../recorders/own-state.ts';
import { endPitVisits, pitStopsRecorder } from '../../recorders/pit-stops.ts';
import { endStintVisits, reindexStintLaps, restartStintLap, stintsRecorder } from '../../recorders/stints.ts';
import { isActiveCar, slotsInUse } from '../../step/active-cars.ts';
import type { StepOutput } from '../../step/types.ts';

type NeutralisingCar = 'SC' | 'VSC';

const CAR_OF_FLAG: Partial<Record<SessionFlag, NeutralisingCar>> = { sc: 'SC', vsc: 'VSC' };
/** Indexed by the SCAR `safetyCarType`: 0 is none (its resume duplicates the car's own), 3 the formation lap. */
const CAR_OF_SC_TYPE: ReadonlyArray<NeutralisingCar | undefined> = [undefined, 'SC', 'VSC'];
const FORMATION_SC_TYPE = 3;
/** Indexed by the SCAR `eventType`. */
const STAGES: readonly NeutralisedStage[] = ['deployed', 'returning', 'returned', 'resume'];

/**
 * Session time after a SCAR deployment within which the safety car status must show its car: the status follows the
 * SCAR by 0.6 to 1.31 s in the recordings (inventory 1.4); spec 3.1, user ruling 2026-10-30.
 */
const CONFIRM_WITHIN_MS = 3000;
/**
 * A race joined with a lap timer above this is under way: on the grid the timers read 0, or 510 ms for the cars past
 * the line in raceZandvoortOnline's hold (t1-diagnosis.md S3).
 */
const UNDER_WAY_LAP_TIME_MS = 1000;
/** What the formation discard cuts back; the phases, flag phases and pauses stay (spec 3.2). */
const DISCARDED = ['laps', 'stints', 'pitStops', 'events', 'crossings'] as const satisfies ReadonlyArray<keyof TrackerLengths>;

type Discarded = (typeof DISCARDED)[number];

/**
 * Whether a void fact (C27, a flashback) covers position `index` of `list`. The tracker reads and cuts the log itself (an
 * old mechanism, until Task 9), so it skips what a flashback undid, as the projection does.
 */
const isVoided = (log: Log, list: Discarded, index: number): boolean =>
  log.voids.some((v) => {
    const range = v.ranges[list];
    return range !== undefined && index >= range[0] && index < range[1];
  });

/** The facts of `list` no flashback undid. */
export const unvoided = <K extends Discarded>(log: Log, list: K): Log[K] =>
  log.voids.length === 0 ? log[list] : (log[list].filter((_, i) => !isVoided(log, list, i)) as Log[K]);

/** The log's lists after the discard cut `list` back to `length`: void ranges past it named facts that are gone, so they go too. */
const cutVoids = (log: Log, list: Discarded, length: number): void => {
  log.voids.forEach((v, i) => {
    const range = v.ranges[list];
    if (range === undefined || range[1] <= length) return;
    const { [list]: _cut, ...rest } = v.ranges;
    log.voids[i] = { ...v, ranges: range[0] < length ? { ...rest, [list]: [range[0], length] as const } : rest };
  });
};

/** The lengths of the log's lists the tracker cuts back or re-stamps. */
const trackerLengths = (log: Log): TrackerLengths => ({
  laps: log.laps.length,
  stints: log.stints.length,
  pitStops: log.pitStops.length,
  crossings: log.crossings.length,
  events: log.events.length,
  flagPhases: log.flagPhases.length,
  sessionPhases: log.sessionPhases.length,
  pauses: log.pauses.length,
});

/** The lap of the car in first place; 0 when no car in the session holds it. */
const leaderLap = (state: EngineState): number => {
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
  state.log.sessionPhases.push(book.unconfirmed.closed);
  book.unconfirmed = undefined;
};

/**
 * An unconfirmed neutralisation never happened: the phase it replaced goes on as before. Readers already saw it open, so
 * the step discarded a timeline (review 2 B2, ruling 2026-10-30): they start over, as at a flashback. So does a phase
 * boundary at a shared moment (`atBoundary`).
 */
const drop = (state: EngineState, out: StepOutput): void => {
  const book = state.open.phaseBook;
  if (!book.unconfirmed) return;
  state.open.situations.session = book.unconfirmed.replaced;
  book.unconfirmed = undefined;
  out.discarded = true;
};

/**
 * Whether the history holds an entry a reader may fold against the session phases at or after `boundary`: an event
 * (`at >= boundary`), a mini-sector crossing (`at >= boundary`), a lap (`completedAt >= boundary`) or a pit stop
 * (`pitLaneExit >= boundary`: the stop's last moment, so one only partly past the boundary counts too). Each entry's
 * own time is compared, not the clock, so an entry recorded before a fall of the session time lies above every lower
 * time. The phases themselves (session and flag phases), the stints (by lap, no time) and the pauses (display only,
 * spec 3.1) are not folded against phases. Read before the frame's own entries are recorded (the situation tracker is
 * the first history step), so every entry it finds was recorded by an earlier frame.
 */
const recordedAtOrAfter = (log: Log, boundary: SessionTime): boolean =>
  unvoided(log, 'events').some((e) => e.at >= boundary) ||
  unvoided(log, 'crossings').some((c) => c.at >= boundary) ||
  unvoided(log, 'laps').some((l) => l.completedAt >= boundary) ||
  unvoided(log, 'pitStops').some((p) => p.pitLaneExit >= boundary);

/**
 * `next` opens where the phase in progress closes. Several frames can carry one moment of the race clock (a clock
 * standing for a few frames, the stale frames after a rewind), and the clock can fall before the race start, so an
 * earlier frame may have recorded an entry at or after that time (`recordedAtOrAfter`; spans are `[start, end)`). The
 * boundary moves that entry out of the closed phase into `next` after readers folded it: the step discarded a timeline
 * (spec 3.1, "A boundary at a shared moment", ruling 2026-10-31 made exact after review 6), and readers start over, as
 * at a dropped neutralisation; lowering `delta.before` instead would fold entries twice. A boundary that moves no entry
 * discards nothing: the grid's first start light (no grid frame recorded anything), the simulated end at the last
 * frame's time when that frame recorded nothing there, a phase the session's first frame opens (the history is empty).
 * The rule holds for every phase kind, at its opening and its closing: today `gaps` and `incidents` read the
 * neutralised and suspended phases, and covering every kind keeps it exact for any reader of the phases.
 */
const atBoundary = (state: EngineState, next: OpenSessionPhase, out: StepOutput): void => {
  if (recordedAtOrAfter(state.log, next.start)) out.discarded = true;
};

/** Closes the phase in progress where `next` opens and opens `next`. */
const enter = (state: EngineState, out: StepOutput, next: OpenSessionPhase, restart?: 'standing' | 'rolling'): void => {
  atBoundary(state, next, out);
  confirm(state);
  const { situations } = state.open;
  state.log.sessionPhases.push(closed(state, situations.session, next.start, restart));
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
const deploy = (state: EngineState, out: StepOutput, car: NeutralisingCar, at: SessionTime): void => {
  const { situations, phaseBook } = state.open;
  if (isOver(situations.session) || carOf(situations.session) === car) return;
  const next = neutralised(state, car, at, ['deployed']);
  atBoundary(state, next, out);
  // An earlier deployment still waiting stands: this one closes it.
  confirm(state);
  const replaced = situations.session;
  phaseBook.unconfirmed = { closed: closed(state, replaced, at, 'rolling'), replaced };
  situations.session = next;
};

/**
 * A deployment stands once the safety car status shows its car; when it has not within `CONFIRM_WITHIN_MS` of the SCAR,
 * it never happened (an SC undone by a flashback, one announced before a simulated end).
 */
const confirmOrExpire = (state: EngineState, at: SessionTime, out: StepOutput): void => {
  const pending = state.open.phaseBook.unconfirmed;
  if (!pending) return;
  if (CAR_OF_FLAG[state.session.flag] === carOf(state.open.situations.session)) confirm(state);
  else if (at - pending.closed.end > CONFIRM_WITHIN_MS) drop(state, out);
};

/**
 * The formation phase, from the grid (spec 3.1). It notes the history lengths it opens at: lights out cuts the history
 * back to them (3.2).
 */
const openFormation = (state: EngineState, out: StepOutput, at: SessionTime): void => {
  if (!isRace(state) || state.open.situations.session.kind !== 'preStart') return;
  state.open.phaseBook.formationFrom = trackerLengths(state.log);
  enter(state, out, phase(state, 'formation', at));
};

/**
 * The first start light, from the grid, the formation lap or a red flag (a standing restart). It ends the formation
 * phase: as the game reset the session time at the formation lap's end, that span ends on the race clock, below its
 * start.
 */
const startLights = (state: EngineState, out: StepOutput, at: SessionTime): void => {
  const { kind } = state.open.situations.session;
  if (!isRace(state) || (kind !== 'preStart' && kind !== 'formation' && kind !== 'suspended')) return;
  if (kind !== 'suspended') state.open.phaseBook.startFrom = trackerLengths(state.log);
  enter(state, out, phase(state, 'startLights', at), 'standing');
};

/**
 * Rebuilds what the lap and stint recorders keep of the recorded laps from the laps left in the history: the discard
 * cut the log in place (an old mechanism; Task 9 removes it), so their own state follows it.
 */
const reindexRecordedLaps = (state: EngineState): void => {
  const laps = unvoided(state.log, 'laps');
  reindexLaps(ownStateOf(state, lapsRecorder), laps);
  reindexStintLaps(ownStateOf(state, stintsRecorder), laps);
};

/**
 * Lights out after a formation lap discards what the formation recorded (spec 3.2): the history goes back to its
 * lengths when the formation opened, but for the start lights; the phases, flag phases and pauses stay. Mini-sector
 * cursors start over. Open pit visits go: a car in the pit lane at lights out starts from it, which is no pit stop, as
 * a car leaving the garage makes none (review 2 B4).
 */
const discardFormation = (state: EngineState, from: TrackerLengths): void => {
  // Cuts the log in place (an old mechanism; Task 9 replaces it with hiding by stamp): the step is `rewritten`.
  const { log } = state;
  const lights = log.events.slice(from.events).filter((e, i) => e.kind === 'startLights' && !isVoided(log, 'events', from.events + i));
  for (const key of DISCARDED) {
    log[key].splice(from[key]);
    cutVoids(log, key, from[key]);
  }
  log.events.push(...lights);
  reindexRecordedLaps(state);
  restartMiniSectors(ownStateOf(state, miniSectorsRecorder));
  endPitVisits(ownStateOf(state, pitStopsRecorder));
  endLapVisits(ownStateOf(state, lapsRecorder));
  endStintVisits(ownStateOf(state, stintsRecorder));
};

/**
 * Lights out ends the start lights and opens racing; the race's first lights out is the race start. There every car's
 * lap starts over from its start, the formation lap (if any) is discarded, and the settling window opens (3.3). A
 * restart after a red flag is no race start.
 */
const lightsOut = (state: EngineState, frame: Frame, at: SessionTime, out: StepOutput): void => {
  const phaseFrom = state.log.sessionPhases.length;
  enter(state, out, phase(state, 'racing', at));
  const book = state.open.phaseBook;
  const start = book.formationFrom ?? book.startFrom;
  if (!start) return;
  if (book.formationFrom) {
    discardFormation(state, book.formationFrom);
    out.rewritten = true;
  }
  const slots = slotsInUse(state);
  const laps = ownStateOf(state, lapsRecorder), stints = ownStateOf(state, stintsRecorder);
  for (const car of state.cars) {
    if (!isActiveCar(car.id, slots, car.timing.resultStatus) || car.updatedAt.lapData === undefined) continue;
    restartLap(laps, car, at);
    restartStintLap(stints, car);
  }
  // The start's entries: the start lights (all that is left from before lights out) and everything from here on.
  book.lightsOut = { frameId: frame.frameId, from: { ...trackerLengths(state.log), events: start.events }, phaseFrom };
  book.formationFrom = undefined;
  book.startFrom = undefined;
};

const applySafetyCarEvent = (state: EngineState, out: StepOutput, details: EventDetailsOf<'SCAR'>, at: SessionTime): void => {
  if (details.safetyCarType === FORMATION_SC_TYPE && details.eventType === 0) return openFormation(state, out, at);
  const car = CAR_OF_SC_TYPE[details.safetyCarType];
  const stage = STAGES[details.eventType];
  if (!car || !stage) return;
  if (stage === 'deployed') return deploy(state, out, car, at);
  if (carOf(state.open.situations.session) !== car) return;
  addStage(state, stage, at);
  // A resume sent twice (types 1 and 0) closes once: the second finds no neutralisation open.
  if (stage === 'resume') enter(state, out, green(state, at));
};

/** A red flag suspends the session until its restart (not yet seen in a recording: spec principle 4). */
const suspend = (state: EngineState, out: StepOutput, at: SessionTime): void => {
  const open = state.open.situations.session;
  if (isOver(open) || open.kind === 'suspended') return;
  enter(state, out, { ...phase(state, 'suspended', at), detail: { kind: 'suspended', restart: unknown('notReceived') } });
};

/** The race winner or the chequered flag, whichever first, finishes a race under way. */
const finish = (state: EngineState, out: StepOutput, at: SessionTime): void => {
  const { kind } = state.open.situations.session;
  if (isRace(state) && (kind === 'racing' || kind === 'neutralised' || kind === 'suspended')) enter(state, out, phase(state, 'finished', at));
};

/** Every car in the session has finished: time over in practice or qualifying (a player who left retires instead). */
const everyCarFinished = (state: EngineState): boolean => {
  const slots = slotsInUse(state);
  const inSession = state.cars.filter((car) => isActiveCar(car.id, slots, car.timing.resultStatus));
  return inSession.length > 0 && inSession.every((car) => car.timing.resultStatus === 'finished');
};

/** SEND ends the session: a neutralisation not yet confirmed is dropped. Practice and qualifying finish on time over. */
const endSession = (state: EngineState, at: SessionTime, out: StepOutput): void => {
  if (state.open.situations.session.kind === 'postSession') return;
  drop(state, out);
  const open = state.open.situations.session;
  if (!isRace(state) && !isOver(open) && everyCarFinished(state)) enter(state, out, phase(state, 'finished', at));
  enter(state, out, phase(state, 'postSession', at));
};

/**
 * The game simulated the rest of the session (a forward jump of the session time, or a final classification without
 * SEND): what it never confirmed did not happen, and the post-session opens at `at`.
 */
export const enterPostSession = (state: EngineState, at: SessionTime, out: StepOutput): void => {
  if (state.open.situations.session.kind === 'postSession') return;
  drop(state, out);
  enter(state, out, phase(state, 'postSession', at));
};

const applyEvent = (state: EngineState, frame: Frame, details: EventDetails, out: StepOutput): void => {
  const at = frame.sessionTime;
  switch (details.code) {
    case 'SCAR':
      return applySafetyCarEvent(state, out, details, at);
    case 'STLG':
      return startLights(state, out, at);
    case 'LGOT':
      // Lights out only ends the start lights: one before any start light (the formation lap's own) is none.
      if (state.open.situations.session.kind === 'startLights') lightsOut(state, frame, at, out);
      return;
    case 'RDFL':
      return suspend(state, out, at);
    case 'RCWN':
    case 'CHQF':
      return finish(state, out, at);
    case 'SEND':
      return endSession(state, at, out);
    default:
      return;
  }
};

/**
 * A change of the safety car status: into the formation lap opens it; into SC or VSC confirms the neutralisation it
 * shows, or opens one from any phase but the session's end (no SCAR: a late join, or a game that sent none), and out
 * of it closes the confirmed one.
 */
const applyStatus = (state: EngineState, out: StepOutput, at: SessionTime): void => {
  const { flag } = state.session;
  const last = state.open.lastFlag;
  state.open.lastFlag = flag;
  if (flag === last) return;
  if (flag === 'formation') return openFormation(state, out, at);
  const open = state.open.situations.session;
  const entered = CAR_OF_FLAG[flag];
  if (entered) {
    if (carOf(open) === entered) return confirm(state);
    if (!isOver(open)) enter(state, out, neutralised(state, entered, at, []), 'rolling');
    return;
  }
  const left = CAR_OF_FLAG[last];
  if (left && carOf(open) === left && !state.open.phaseBook.unconfirmed) enter(state, out, green(state, at));
};

/**
 * The race is under way: the leader past lap 1, or a lap timer running. Read on the frame the engine joins a race, and
 * on every frame of a grid without a formation status, where a join after the last start light saw none (review 2 B1).
 */
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
    state.open.phaseBook.formationFrom = trackerLengths(state.log);
    open = joined(phase(state, 'formation', at));
  } else if (kind === 'race') open = raceUnderWay(state) ? joined(phase(state, 'racing', at)) : phase(state, 'preStart', at);
  else open = timeLeftMs < durationMs ? joined(phase(state, 'running', at)) : phase(state, 'preStart', at);
  state.open.situations.session = open;
};

/**
 * Applies the frame's phase signals, in order: the confirmation (or the expiry) of a waiting neutralisation, the events
 * (so a SCAR and the status change of the same frame make one neutralisation), the safety car status, a final
 * classification, and on the grid the clock starting in practice and qualifying, or a race already under way.
 */
export const applyPhaseSignals = (state: EngineState, frame: Frame, out: StepOutput): void => {
  const at = frame.sessionTime;
  confirmOrExpire(state, at, out);
  for (const { details } of frame.events) applyEvent(state, frame, details, out);
  applyStatus(state, out, at);
  if (frame.finalClassification) enterPostSession(state, at, out);
  if (state.open.situations.session.kind !== 'preStart') return;
  if (!isRace(state)) {
    if (at > state.sessionTime) enter(state, out, green(state, at));
  } else if (state.session.flag !== 'formation' && raceUnderWay(state)) enter(state, out, { ...phase(state, 'racing', at), joinedAt: true });
};
