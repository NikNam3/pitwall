// The race's car-activity sub-machine (contract C9, C11, C12, C13, C14, C15, C17, C18, C19, C20, C26, C40, C85): per car,
// race only, what a car is doing by the race's rules, from the lights out: racingLap, inLap, boxStop, servingPenalty
// (`ServingPenaltyDetail`), outLap, finished, coolDown, notCompeting. Upstream: car-location, car-status, penalties and
// session-phase-race (weekend-phase in its upstream closure, C14); signals pitStatus, pitLaneTimerActive, resultStatus
// and the events DTSV, SGSV; values the timing area. It reads no driverStatus.
// - The scope begins at the lights out (the race session phase first past grid, formation and startLights; a later
//   standing restart changes nothing). Every car with a car-status span opens then: in the pit lane outLap, otherwise
//   racingLap, not competing notCompeting. A race joined past the lights out, and a car whose car-status span first
//   appears after it, opens the car's current activity with `joinedAt` (`currentKind`).
// - A pit visit: the pit entry (car-location track -> pitLane) opens inLap, or servingPenalty while a drive-through or
//   stop-go is owed; the box (pit status in the pit area) turns inLap into boxStop; leaving it turns boxStop into outLap;
//   a pit exit from inLap opens outLap. outLap ends at the first lap rise on track.
// - servingPenalty holds the whole visit, the box included (the box time of a penalty visit is servingPenalty, §2.7).
//   It opens unconfirmed and is confirmed by the car's DTSV (drive-through) or SGSV (stop-go); it closes on the later
//   of the pit exit and the confirmation, or `confirmed: false` on the first frame more than `SERVED_WITHIN_MS` after
//   the pit exit (C18); outLap follows. The pending confirmation is the car's own open state; nothing is rewritten.
// - finished opens on the first frame whose result status is finished on which, or one frame after which, the car
//   crossed the line (its lap distance fell), from racingLap, outLap or inLap; coolDown follows on the next frame.
// - notCompeting while car-status is retired, disqualified or absent; back to the current activity when it competes.
// Stop-gos, a pit-lane start and the returns from notCompeting are not yet seen (C19). The facts:
// docs/research/09-situations-inventory.md §2.1-2.5, §2.7, §2.10.
import { carActivityRaceSpans, carId as toCarId, type CarId, type OpenSpan, type ServingPenaltyDetail, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import type { MachineInput, MachineStep, SubMachine } from '../machine.ts';
import { carView, currentKind, entryKind, lightsOutKind, SESSION_PHASE, type CarView, type Kind, type Location } from './car-view.ts';

/** How long after the pit exit a DTSV or SGSV may still confirm the penalty served (inventory §2.7: 7.1 s). */
export const SERVED_WITHIN_MS = 10_000;

/** The race session phases before the lights out: no car has an activity yet. */
const BEFORE_LIGHTS_OUT: ReadonlySet<string> = new Set(['grid', 'formation', 'startLights']);
/** The kinds a car can take the chequered flag from. */
const CAN_FINISH: ReadonlySet<Kind> = new Set(['racingLap', 'outLap', 'inLap']);

type Held = {
  id: number;
  kind: Kind;
  start: SessionTime;
  startFrame: number;
  confirmed: boolean;
  detail: ServingPenaltyDetail | undefined;
  joinedAt?: true;
  /** servingPenalty: when the car left the pit lane, once it has. */
  exitAt?: SessionTime;
};
/** Per car slot: its open span (none before its scope begins), the spans it has opened, and what it was on the frame before. */
type CarOpen = { held: Held | undefined; opened: number; location: Location | undefined; lap: number; lapDistanceM: number; crossed: boolean };
/** `sawBeforeLightsOut`: the machine saw the race before its lights out; `started`: the lights out lies behind. */
type Open = { sawBeforeLightsOut: boolean; started: boolean; cars: Array<CarOpen | undefined> };

const toOpenSpan = (held: Held, car: CarId): OpenSpan => ({
  machine: 'car-activity-race',
  id: held.id,
  carId: car,
  kind: held.kind,
  start: held.start,
  startFrame: held.startFrame,
  confirmed: held.confirmed,
  detail: held.detail,
  ...(held.joinedAt ? { joinedAt: true as const } : {}),
});

/** A new span of `kind` for `car` on this frame: servingPenalty unconfirmed, naming the penalty owed. */
const opening = (kind: Kind, car: CarView, id: number, input: DeepReadonly<MachineInput>, joined: boolean): Held => ({
  id,
  kind,
  start: input.at,
  startFrame: input.frameNumber,
  confirmed: kind !== 'servingPenalty',
  detail: kind === 'servingPenalty' ? car.owed : undefined,
  ...(joined ? { joinedAt: true as const } : {}),
});

/** A car's step: the kind of its next span (and how the one it closes ends), or its open span as it now stands. */
type Next = { kind: Kind; confirmed?: boolean } | Held;

/** The DTSV or SGSV that serves the penalty of `held` for this car arrived on this frame. */
const servedNow = (held: Held, car: CarView, input: DeepReadonly<MachineInput>): boolean => {
  const code = held.detail?.penalty === 'stopGo' ? 'SGSV' : 'DTSV';
  return input.signals.events.some((event) => event.code === code && event.carId === car.carId);
};

/**
 * The next kind of a car with an open span `held`, given what it was on the frame before (`before`) and whether it
 * crossed the line on this frame (`crossed`); `held` itself (or as it now stands) while the kind holds.
 */
const next = (held: Held, before: CarOpen, car: CarView, crossed: boolean, input: DeepReadonly<MachineInput>): Next => {
  if (car.competing === undefined) return held;
  if (!car.competing) return held.kind === 'notCompeting' ? held : { kind: 'notCompeting' };
  const entered = before.location === 'track' && car.location === 'pitLane';
  const onTrack = car.location === 'track';
  if (CAN_FINISH.has(held.kind) && car.resultStatus === 'finished' && (crossed || before.crossed)) return { kind: 'finished' };
  switch (held.kind) {
    case 'notCompeting':
      return { kind: currentKind(car) };
    case 'racingLap':
      return entered ? { kind: entryKind(car) } : held;
    case 'inLap':
      if (car.pitStatus === 'inPitArea') return { kind: 'boxStop' };
      return onTrack ? { kind: 'outLap' } : held;
    case 'boxStop':
      return car.pitStatus === 'inPitArea' ? held : { kind: 'outLap' };
    case 'outLap':
      if (entered) return { kind: entryKind(car) };
      return onTrack && car.lap > before.lap ? { kind: 'racingLap' } : held;
    case 'servingPenalty': {
      const confirmed = held.confirmed || servedNow(held, car, input);
      const exitAt = held.exitAt ?? (onTrack ? input.at : undefined);
      if (exitAt !== undefined && confirmed) return { kind: 'outLap', confirmed: true };
      if (exitAt !== undefined && input.at - exitAt > SERVED_WITHIN_MS) return { kind: 'outLap', confirmed: false };
      return { ...held, confirmed, ...(exitAt !== undefined ? { exitAt } : {}) };
    }
    case 'finished':
      return { kind: 'coolDown' };
    case 'coolDown':
      return held;
  }
};

const machine: SubMachine<Open> = {
  id: 'car-activity-race',
  appliesTo: ['race'],
  spans: carActivityRaceSpans,
  inputs: { signals: ['pitStatus', 'pitLaneTimerActive', 'resultStatus', 'events'], values: ['timing'], upstream: ['car-location', 'car-status', 'penalties', SESSION_PHASE] },
  transitions: [
    ['none', 'racingLap'],
    ['none', 'inLap'],
    ['none', 'boxStop'],
    ['none', 'servingPenalty'],
    ['none', 'outLap'],
    ['none', 'coolDown'],
    ['none', 'notCompeting'],
    ['racingLap', 'inLap'],
    ['racingLap', 'servingPenalty'],
    ['racingLap', 'finished'],
    ['inLap', 'boxStop'],
    ['inLap', 'outLap'],
    ['inLap', 'finished'],
    ['boxStop', 'outLap'],
    ['servingPenalty', 'outLap'],
    ['outLap', 'racingLap'],
    ['outLap', 'inLap'],
    ['outLap', 'servingPenalty'],
    ['outLap', 'finished'],
    ['finished', 'coolDown'],
    ...(['racingLap', 'inLap', 'boxStop', 'servingPenalty', 'outLap', 'finished', 'coolDown'] as const).map((from) => [from, 'notCompeting'] as const),
    ...(['racingLap', 'inLap', 'boxStop', 'servingPenalty', 'outLap', 'coolDown'] as const).map((to) => ['notCompeting', to] as const),
  ],
  init: () => ({ sawBeforeLightsOut: false, started: false, cars: [] }),
  openSpans: (open) => open.cars.flatMap((car, index): OpenSpan[] => (car?.held === undefined ? [] : [toOpenSpan(car.held, toCarId(index))])),
  step(open, input): MachineStep<Open> {
    const closed: MachineStep<Open>['closed'] = [];
    const phase = input.upstream[SESSION_PHASE]?.[0]?.kind;
    const beforeLightsOut = phase !== undefined && BEFORE_LIGHTS_OUT.has(phase);
    const lightsOutNow = !open.started && phase !== undefined && !beforeLightsOut;
    const started = open.started || lightsOutNow;
    const sawBeforeLightsOut = open.sawBeforeLightsOut || (!open.started && beforeLightsOut);
    const cars = input.signals.cars.map((signals, index): CarOpen | undefined => {
      const car = carView(input, index, signals);
      const before = open.cars[index];
      if (car === undefined) return before;
      const crossed = before !== undefined && car.lapDistanceM < before.lapDistanceM;
      const seen = { location: car.location, lap: car.lap, lapDistanceM: car.lapDistanceM, crossed };
      const opened = before?.opened ?? 0;
      if (!started) return { held: undefined, opened, ...seen };
      if (before?.held === undefined) {
        if (car.competing === undefined) return { held: undefined, opened, ...seen };
        const atLightsOut = lightsOutNow && sawBeforeLightsOut;
        const kind = atLightsOut ? lightsOutKind(car) : currentKind(car);
        return { held: opening(kind, car, opened, input, !atLightsOut), opened: opened + 1, ...seen };
      }
      const step = next(before.held, before, car, crossed, input);
      if ('id' in step) return { held: step, opened, ...seen };
      closed.push({ ...toOpenSpan(before.held, car.carId), confirmed: step.confirmed ?? before.held.confirmed, end: input.at });
      return { held: opening(step.kind, car, opened, input, false), opened: opened + 1, ...seen };
    });
    return { open: { sawBeforeLightsOut, started, cars }, closed };
  },
};

export default machine;
