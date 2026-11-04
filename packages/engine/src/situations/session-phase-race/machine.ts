// The race's session-phase sub-machine (contract C9, C14, C15, C17, C18, C36): session-scoped, for the race phase (the
// sprint included), after the weekend phase. Ported from the legacy tracker (`history/situations/session-phase.ts`) with
// the signal orders of docs/research/09-situations-inventory.md §1.1-1.7, §7. The spans tile the session from the first
// frame the machine runs: `grid`; `formation` (the formation status, or its SCAR); `startLights` (the first start light,
// from the grid, the formation lap or a red flag's standing restart); `racing` (lights out); `neutralised` (an SC or VSC
// deployment opens it at once, unconfirmed until the safety car status shows its car, C18; the status alone opens it
// too); `suspended` (a red flag); `finished` (the race winner or the chequered flag); `postSession` (SEND, or the clock's
// simulated end, C36). A session joined in progress opens its current phase with `joinedAt` (Review Focus 2). The end
// of a session is a signal, never the final classification's arrival (user ruling, Task 9).
import { known, sessionPhaseRaceSpans, unknown, type NeutralisedDetail, type NeutralisedStage, type SessionFlag, type SessionTime, type SuspendedDetail } from '@pitwall/domain';
import type { SituationEvent } from '../../signals/types.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import { CAR_STATUS } from '../car-status/in-session.ts';
import type { MachineInput, MachineStep, SubMachine } from '../machine.ts';
import {
  carsInSession,
  draftOf,
  enter as enterPhase,
  eventsOf,
  initialPhaseOpen,
  isPostSession,
  kindOf,
  simulatedEnd,
  stepOf,
  withDetail,
  type PhaseDraft,
  type PhaseOpen,
} from '../session-phase/phases.ts';

/** The car of a neutralisation. */
type NeutralisingCar = 'SC' | 'VSC';

/**
 * A neutralisation opened on its SCAR deployment and not yet confirmed by the safety car status (C18): the machine's
 * pending confirmation. `replaced`: the span the deployment closed, as it was open, which goes on if the deployment is
 * never confirmed in time.
 */
type PendingDeployment = { car: NeutralisingCar; deployedAt: SessionTime; replaced: { kind: string; detail: unknown } };

/** The race's open state: the shared one plus its safety car bookkeeping (C9). */
type RaceOpen = PhaseOpen & {
  /** The safety car status (a signal, C12) on the previous frame. */
  lastStatus: SessionFlag | undefined;
  /** The deployment the open neutralisation waits to see confirmed. */
  pending?: PendingDeployment | undefined;
};

type Draft = PhaseDraft<RaceOpen>;

/** Opens the next span (`session-phase/phases.ts`); a pending confirmation belongs to the span that closes: it goes. */
const enter = (d: Draft, kind: string, at: SessionTime, opening?: Parameters<typeof enterPhase>[3], closingDetail?: unknown): void => {
  enterPhase(d, kind, at, opening, closingDetail);
  if (d.open.pending !== undefined) d.open = { ...d.open, pending: undefined };
};

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

const CAR_OF_STATUS: Partial<Record<SessionFlag, NeutralisingCar>> = { sc: 'SC', vsc: 'VSC' };

/** The phases a neutralisation can open from: the race under way, another neutralisation, a red flag (a rolling restart). */
const NEUTRALISABLE: ReadonlySet<string> = new Set(['racing', 'neutralised', 'suspended']);
/** The phases the first start light opens from: the grid, the formation lap, a red flag (a standing restart). */
const BEFORE_LIGHTS: ReadonlySet<string> = new Set(['grid', 'formation', 'suspended']);
/** The phases of a race under way, which a red flag suspends (racing, neutralised) and a finish ends (all three). */
const UNDER_WAY: ReadonlySet<string> = new Set(['racing', 'neutralised', 'suspended']);

const neutralisedDetail = (car: NeutralisingCar, stages: NeutralisedDetail['stages']): NeutralisedDetail => ({ car, stages });
const suspendedDetail = (restart: SuspendedDetail['restart']): SuspendedDetail => ({ restart });

/** The car of the neutralisation in progress, if one is. */
const carOf = (d: Draft): NeutralisingCar | undefined =>
  kindOf(d) === 'neutralised' ? (d.open.span?.detail as NeutralisedDetail | undefined)?.car : undefined;

/** A suspension closed by its restart records how it restarted; any other span closes as it is. */
const closingFor = (d: Draft, restart: 'standing' | 'rolling'): SuspendedDetail | undefined =>
  kindOf(d) === 'suspended' ? suspendedDetail(known(restart, d.input.at)) : undefined;

/** The timing (a value, C8) of the cars in the session (car-status's, C43). */
const timingsInSession = (input: DeepReadonly<MachineInput>) => carsInSession(input).flatMap((id) => input.live.cars[id]?.timing ?? []);

/** The lap of the car in first place; 0 when no car in the session holds it. */
const leaderLap = (input: DeepReadonly<MachineInput>): number => timingsInSession(input).find((timing) => timing.position === 1)?.lap ?? 0;

/** The race is under way: the leader past lap 1, or a lap timer running past `UNDER_WAY_LAP_TIME_MS`. */
const raceUnderWay = (input: DeepReadonly<MachineInput>): boolean =>
  leaderLap(input) > 1 || timingsInSession(input).some((timing) => timing.currentLapTimeMs > UNDER_WAY_LAP_TIME_MS);

/**
 * The first frame the machine runs (C14; Review Focus 2): a race joined in progress opens its current phase there,
 * marked `joinedAt` (an SC or VSC status, the formation status, a race under way); otherwise the grid.
 */
const join = (d: Draft): void => {
  const { input } = d;
  const status = input.signals.session.safetyCarStatus;
  const car = CAR_OF_STATUS[status];
  if (car) enter(d, 'neutralised', input.at, { joined: true, detail: neutralisedDetail(car, []) });
  else if (status === 'formation') enter(d, 'formation', input.at, { joined: true });
  else if (raceUnderWay(input)) enter(d, 'racing', input.at, { joined: true });
  else enter(d, 'grid', input.at);
  // The status the join read is no change of it (`applyStatus`).
  d.open = { ...d.open, lastStatus: status };
};

/** Racing again where a neutralisation ends. */
const green = (d: Draft): void => enter(d, 'racing', d.input.at);

/**
 * A deployment stands once the safety car status shows its car (the open span turns confirmed); when it has not within
 * `CONFIRM_WITHIN_MS` of the SCAR, the span closes `confirmed: false` and the phase it replaced goes on (C18).
 */
const confirmOrExpire = (d: Draft): void => {
  const { pending, span } = d.open;
  if (!pending || !span) return;
  if (CAR_OF_STATUS[d.input.signals.session.safetyCarStatus] === pending.car) d.open = { ...d.open, span: { ...span, confirmed: true }, pending: undefined };
  else if (d.input.at - pending.deployedAt > CONFIRM_WITHIN_MS) enter(d, pending.replaced.kind, d.input.at, { detail: pending.replaced.detail });
};

/**
 * A SCAR deployment opens the neutralisation at once, unconfirmed until the safety car status shows it (C18). An SC
 * deployed under a VSC closes the VSC; one deployed in a suspension is the rolling restart.
 */
const deploy = (d: Draft, car: NeutralisingCar): void => {
  const kind = kindOf(d);
  if (kind === undefined || !NEUTRALISABLE.has(kind) || carOf(d) === car) return;
  const { span, pending } = d.open;
  const replaced = pending?.replaced ?? { kind, detail: span?.detail };
  const at = d.input.at;
  enter(d, 'neutralised', at, { confirmed: false, detail: neutralisedDetail(car, [{ stage: 'deployed', at }]) }, closingFor(d, 'rolling'));
  d.open = { ...d.open, pending: { car, deployedAt: at, replaced } };
};

/** The open neutralisation of `car` with one more stage; a resume closes it and racing opens. */
const stage = (d: Draft, car: NeutralisingCar, next: NeutralisedStage): void => {
  if (carOf(d) !== car) return;
  const detail = d.open.span?.detail as NeutralisedDetail;
  withDetail(d, neutralisedDetail(car, [...detail.stages, { stage: next, at: d.input.at }]));
  // A resume sent twice (types 1 and 0) closes once: the second (type 0, no car) is no stage of an open one.
  if (next === 'resume') green(d);
};

/** The formation lap, from the grid (its status or its SCAR). */
const formation = (d: Draft): void => {
  if (kindOf(d) === 'grid') enter(d, 'formation', d.input.at);
};

const applyEvent = (d: Draft, event: DeepReadonly<SituationEvent>): void => {
  const kind = kindOf(d) ?? '';
  const { at } = d.input;
  switch (event.code) {
    case 'SCAR':
      if (event.car === 'formation') return event.stage === 'deployed' ? formation(d) : undefined;
      if (event.car === 'none') return;
      return event.stage === 'deployed' ? deploy(d, event.car) : stage(d, event.car, event.stage);
    case 'STLG':
      if (BEFORE_LIGHTS.has(kind)) enter(d, 'startLights', at, {}, closingFor(d, 'standing'));
      return;
    case 'LGOT':
      // Lights out only ends the start lights: one before any start light (the formation lap's own) is none.
      if (kind === 'startLights') enter(d, 'racing', at);
      return;
    case 'RDFL':
      // A red flag suspends the race until its restart (not yet seen in a recording, inventory §1.12; C19).
      if (kind === 'racing' || kind === 'neutralised') enter(d, 'suspended', at, { detail: suspendedDetail(unknown('notReceived')) });
      return;
    case 'RCWN':
    case 'CHQF':
      // The race winner or the chequered flag, whichever first, finishes a race under way.
      if (UNDER_WAY.has(kind)) enter(d, 'finished', at);
      return;
    case 'SEND':
      if (!isPostSession(d)) enter(d, 'postSession', at);
      return;
    default:
      return;
  }
};

/**
 * A change of the safety car status: into the formation lap opens it; into SC or VSC confirms the neutralisation it
 * shows, or opens one (no SCAR: a late join, or a game that sent none); out of it closes the confirmed one.
 */
const applyStatus = (d: Draft): void => {
  const status = d.input.signals.session.safetyCarStatus;
  const last = d.open.lastStatus;
  if (status === last) return;
  if (status === 'formation') return formation(d);
  const entered = CAR_OF_STATUS[status];
  if (entered) {
    if (carOf(d) === entered) {
      if (d.open.pending && d.open.span) d.open = { ...d.open, span: { ...d.open.span, confirmed: true }, pending: undefined };
      return;
    }
    const kind = kindOf(d);
    if (kind !== undefined && NEUTRALISABLE.has(kind)) enter(d, 'neutralised', d.input.at, { detail: neutralisedDetail(entered, []) }, closingFor(d, 'rolling'));
    return;
  }
  const left = last === undefined ? undefined : CAR_OF_STATUS[last];
  if (left && carOf(d) === left && !d.open.pending) green(d);
};

const machine: SubMachine<RaceOpen> = {
  id: sessionPhaseRaceSpans.machine,
  appliesTo: ['race'],
  spans: sessionPhaseRaceSpans,
  inputs: { signals: ['events', 'safetyCarStatus'], values: ['timing'], upstream: ['weekend-phase', CAR_STATUS] },
  transitions: [
    ['none', 'grid'],
    ['none', 'formation'],
    ['none', 'racing'],
    ['none', 'neutralised'],
    ['grid', 'formation'],
    ['grid', 'startLights'],
    ['grid', 'racing'],
    ['formation', 'startLights'],
    ['startLights', 'racing'],
    ['racing', 'neutralised'],
    ['neutralised', 'racing'],
    ['neutralised', 'neutralised'],
    ['racing', 'suspended'],
    ['neutralised', 'suspended'],
    ['suspended', 'startLights'],
    ['suspended', 'neutralised'],
    ['racing', 'finished'],
    ['neutralised', 'finished'],
    ['suspended', 'finished'],
    ['grid', 'postSession'],
    ['formation', 'postSession'],
    ['startLights', 'postSession'],
    ['racing', 'postSession'],
    ['neutralised', 'postSession'],
    ['suspended', 'postSession'],
    ['finished', 'postSession'],
  ],
  init: (): RaceOpen => ({ ...initialPhaseOpen(), lastStatus: undefined }),
  openSpans: (open) => (open.span ? [open.span] : []),
  /**
   * The frame's phase signals, in order: the join on the first frame; the clock's simulated end (step 0's, C7); the
   * confirmation or the expiry of a waiting neutralisation; the events (so a SCAR and the status change of one frame
   * make one neutralisation); the safety car status; on the grid, a race already under way (a join after the last start
   * light saw none, review 2 B1).
   */
  step(previous, input) {
    const d = draftOf<RaceOpen>(sessionPhaseRaceSpans.machine, previous, input);
    if (d.open.span === undefined) join(d);
    simulatedEnd(d, enter);
    confirmOrExpire(d);
    for (const event of eventsOf(input)) applyEvent(d, event);
    applyStatus(d);
    if (kindOf(d) === 'grid' && input.signals.session.safetyCarStatus !== 'formation' && raceUnderWay(input)) enter(d, 'racing', input.at);
    const step: MachineStep<RaceOpen> = stepOf(d);
    return { ...step, open: { ...step.open, lastStatus: input.signals.session.safetyCarStatus } };
  },
};

export default machine;
