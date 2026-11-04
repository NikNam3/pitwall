// The car activity of a practice or qualifying session (contract C3, C9, C12, C14, C15, C17, C18, C19, C26), shared by
// their two sub-machines, which declare the same kinds and transitions; the push kind is `pushLap` in qualifying and
// `flyingLap` in practice. Per car slot, from the upstream car-location, car-status and the phase's session phase, the
// signals `driverStatus` and `resultStatus` and the values lap distance and track length:
// - A car's scope begins with its first car-location span; its first span is a join (`joinedAt`), its kind chosen by
//   `kindOnJoin`. A car-status competing again after `notCompeting` reopens the car's activity the same way.
// - `notCompeting` while car-status is retired, disqualified or absent; `garage` while car-location is `garage` (the
//   box and every teleport into it). A teleport is no lap and no transition except into `garage`, so a car accelerated
//   through the garage (session time up to 31.6x wall time) opens no lap and no transition.
// - `outLap` from leaving the garage to the line; the push kind from the line; `inLap` once the car heads for the pit
//   lane (the in-lap driver status on track during a push, the pit entry) or the session's end ends its out lap or push;
//   `outLap` again at the pit exit without the garage; `finished` at the line once the session has ended for the car.
// - The line is the lap distance on track only: from below 0 to 0 or more, or a wrap (a drop of more than half the
//   track's length). The lap number, the lap timer and the driver status are no line signal, and a line in the pit lane
//   is no line.
// - The session's end for a car: its result status finished, or the session phase finished or post-session. A car set
//   to finished mid-lap is not finished by that alone: its push ends, `inLap`.
// Every `finished` transition and every return from `notCompeting` is not yet seen (C19). The facts behind each rule:
// docs/research/09-situations-inventory.md §1.9, §2.1-2.4, §2.10.
import { carId as toCarId, type FrameNumber, type Metres, type MachineId, type OpenSpan, type SessionTime, type SpanDeclaration, type WeekendPhaseKind } from '@pitwall/domain';
import type { CarSignals } from '../../signals/types.ts';
import type { DeepReadonly } from '../../util/deep-readonly.ts';
import { CAR_STATUS } from '../car-status/in-session.ts';
import type { MachineInput, MachineStep, SubMachine } from '../machine.ts';

/** The sub-machine of where a car physically is. */
const CAR_LOCATION = 'car-location';

type Push = 'pushLap' | 'flyingLap';
type Kind<P extends Push> = 'outLap' | P | 'inLap' | 'garage' | 'finished' | 'notCompeting';
type Location = 'garage' | 'pitLane' | 'track';

/**
 * Per car slot: the open span (the same object while it holds, C40), how many spans the car has had, and what the frame
 * before showed of the car.
 */
type CarOpen = { span: OpenSpan; opened: number; location: Location; lapDistanceM: Metres; ended: boolean };
type Open = { cars: Array<CarOpen | undefined> };

/** What the machine reads of one car on one frame. */
type CarNow = {
  status: string;
  location: Location;
  signals: DeepReadonly<CarSignals>;
  lapDistanceM: Metres;
  /** The session has ended for the car: its result status finished, or the session phase finished or post-session. */
  ended: boolean;
  /** The session as a whole has ended (the session phase finished or post-session). */
  sessionEnded: boolean;
};

const isSessionEnd = (kind: string | undefined): boolean => kind === 'finished' || kind === 'postSession';

/** The line on track: the lap distance from below 0 to 0 or more, or a wrap of more than half the track's length. */
const crossesLine = (before: CarOpen, now: CarNow, trackLengthM: Metres): boolean => {
  if (now.location !== 'track') return false;
  if (before.lapDistanceM < 0 && now.lapDistanceM >= 0) return true;
  return trackLengthM > 0 && before.lapDistanceM - now.lapDistanceM > trackLengthM / 2;
};

/** The kind of a car's activity: a timed sub-machine's push kind and the rules above. */
const rulesOf = <P extends Push>(push: P) => {
  /** The kind a car's first span (or its return from notCompeting) opens with, from this frame alone. */
  const kindOnJoin = (now: CarNow): Kind<P> => {
    if (now.status !== 'competing') return 'notCompeting';
    if (now.location === 'garage') return 'garage';
    if (now.signals.resultStatus === 'finished') return 'finished';
    if (now.sessionEnded) return 'inLap';
    if (now.signals.driverStatus === 'outLap') return 'outLap';
    if (now.location === 'pitLane' || now.signals.driverStatus === 'inLap') return 'inLap';
    return push;
  };

  /** The kind on this frame given the frame before. */
  const nextKind = (before: CarOpen, now: CarNow, trackLengthM: Metres): Kind<P> => {
    const kind = before.span.kind as Kind<P>;
    if (now.status !== 'competing') return 'notCompeting';
    if (now.location === 'garage') return 'garage';
    if (kind === 'notCompeting') return kindOnJoin(now);
    if (kind === 'garage') return 'outLap';
    if (kind === 'finished') return 'finished';
    if (crossesLine(before, now, trackLengthM)) {
      if (now.ended) return 'finished';
      if (kind === 'outLap') return push;
    }
    const lapping = kind === 'outLap' || kind === push;
    if (lapping && before.location === 'track' && now.location === 'pitLane') return 'inLap';
    if (kind === push && now.location === 'track' && now.signals.driverStatus === 'inLap') return 'inLap';
    if (lapping && now.ended && !before.ended) return 'inLap';
    if (kind === 'inLap' && before.location === 'pitLane' && now.location === 'track') return 'outLap';
    return kind;
  };

  return { kindOnJoin, nextKind };
};

/** A practice or qualifying car-activity sub-machine: its span declaration (its id, C15), its phase, its session phase and its push kind. */
export const timedActivityMachine = <P extends Push>(spans: SpanDeclaration, phase: WeekendPhaseKind, sessionPhase: MachineId, push: P): SubMachine<Open> => {
  const { kindOnJoin, nextKind } = rulesOf(push);
  const kinds: ReadonlyArray<Kind<P>> = ['garage', 'outLap', push, 'inLap', 'finished', 'notCompeting'];
  const competing: ReadonlyArray<Kind<P>> = kinds.filter((k) => k !== 'notCompeting');

  const opening = (id: number, index: number, kind: string, start: SessionTime, startFrame: FrameNumber, joined: boolean): OpenSpan => ({
    machine: spans.machine,
    id,
    carId: toCarId(index),
    kind,
    start,
    startFrame,
    confirmed: true,
    detail: undefined,
    ...(joined ? { joinedAt: true as const } : {}),
  });

  /** What the machine reads of car `index`; none before its first car-location span. */
  const carNow = (input: DeepReadonly<MachineInput>, index: number, sessionEnded: boolean): CarNow | undefined => {
    const location = input.upstream[CAR_LOCATION]?.find((s) => s.carId === index)?.kind as Location | undefined;
    const signals = input.signals.cars[index];
    const live = input.live.cars[index];
    if (location === undefined || signals === undefined || live === undefined) return undefined;
    const status = input.upstream[CAR_STATUS]?.find((s) => s.carId === index)?.kind ?? 'competing';
    return { status, location, signals, lapDistanceM: live.timing.lapDistanceM, ended: sessionEnded || signals.resultStatus === 'finished', sessionEnded };
  };

  return {
    id: spans.machine,
    appliesTo: [phase],
    spans,
    inputs: { signals: ['driverStatus', 'resultStatus'], values: ['timing', 'session'], upstream: [CAR_LOCATION, CAR_STATUS, sessionPhase] },
    transitions: [
      ...kinds.map((k) => ['none', k] as const),
      ...competing.map((k) => [k, 'notCompeting'] as const),
      ...competing.map((k) => ['notCompeting', k] as const),
      ...(['outLap', push, 'inLap', 'finished'] as const).map((k) => [k, 'garage'] as const),
      ['garage', 'outLap'],
      ['outLap', push],
      ['outLap', 'inLap'],
      [push, 'inLap'],
      ['inLap', 'outLap'],
      ...(['outLap', push, 'inLap'] as const).map((k) => [k, 'finished'] as const),
    ],
    init: () => ({ cars: [] }),
    openSpans: (open) => open.cars.flatMap((car): OpenSpan[] => (car === undefined ? [] : [car.span])),
    step(open, input): MachineStep<Open> {
      const closed: MachineStep<Open>['closed'] = [];
      const sessionEnded = isSessionEnd(input.upstream[sessionPhase]?.[0]?.kind);
      const trackLengthM = input.live.session.trackLengthM;
      const cars = input.signals.cars.map((_, index): CarOpen | undefined => {
        const before = open.cars[index];
        const now = carNow(input, index, sessionEnded);
        if (now === undefined) return before;
        const kind = before === undefined ? kindOnJoin(now) : nextKind(before, now, trackLengthM);
        const seen = { location: now.location, lapDistanceM: now.lapDistanceM, ended: now.ended };
        if (before !== undefined && before.span.kind === kind) return { ...before, ...seen };
        if (before !== undefined) closed.push({ ...before.span, end: input.at });
        const id = before?.opened ?? 0;
        return { span: opening(id, index, kind, input.at, input.frameNumber, before === undefined), opened: id + 1, ...seen };
      });
      return { open: { cars }, closed };
    },
  };
};
