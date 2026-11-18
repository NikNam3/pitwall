// Shared builders of the `weekend-pace` stand-in and no-basis tests (SP4.3e Task 6): stored earlier sessions of the
// weekend (C62), qualifying laps, and the current session's view with `view.basis` and degradation's output on it.
import { carId, unknown, type CarId, type CarKey, type FrameNumber, type Known, type LapRecord, type Span, type WeekendPace, type WeekendPhase } from '@pitwall/domain';
import type { BasisContext, EngineView, Projection, QuickCalculator, StoredSession } from '@pitwall/engine/readers';
import { carState, history, lap } from '../../../../test-support/builders/index.ts';
import { degradationCalculator, DEGRADATION, weekendPaceCalculator } from '../../src/index.ts';
import { guardedQuick, RACE, situatedView } from '../situated.ts';

/** The calculator through its guarded view (C41): a read it does not declare throws. */
export const calc = { compute: (view: EngineView): WeekendPace => guardedQuick(weekendPaceCalculator as QuickCalculator<WeekendPace>).compute(view) };

/** The default seat of slot `i` (C62: team and race number). */
export const KEY = (i: number): CarKey => ({ teamId: i, raceNumber: 10 + i });

/** The seats `0..n-1`, each its default key. */
export const seats = (n: number): Record<number, CarKey> => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, KEY(i)]));

/** A qualifying lap of car `car`: `lapTimeMs`, valid unless said otherwise, with a qualifying fuel load. */
export const qualiLap = (car: number, lapNumber: number, lapTimeMs: number, valid = true): LapRecord =>
  lap({
    carId: carId(car),
    lapNumber,
    lapTimeMs,
    completedAt: lapNumber * 100_000 + car * 100,
    actualCompound: 'C4',
    visualCompound: 'soft',
    fuelAtStartKg: { known: true, value: 10, at: lapNumber * 100_000 },
    valid: { lap: valid, sectors: [valid, valid, valid] },
  });

/** A stored earlier session of the weekend (C62): `phase` as its closed `weekend-phase` span, a closed `competing` car-status span per seat, its lists. */
export function stored(uid: string, phase: WeekendPhase, seatsOf: Record<number, CarKey>, lists: Partial<Projection> = {}): StoredSession {
  if (phase.kind === 'pending') throw new Error('a stored session is never pending');
  const { kind, ...detail } = phase;
  const closed = (machine: string, k: string, d: unknown, car?: number): Span => ({
    machine,
    id: 0 as Span['id'],
    kind: k,
    start: 0,
    end: 3_600_000,
    confirmed: true,
    detail: d,
    startFrame: 1 as FrameNumber,
    endFrame: 50_000 as FrameNumber,
    ...(car !== undefined && { carId: carId(car) }),
  });
  const slots = Object.keys(seatsOf).map(Number);
  const spans = { 'weekend-phase': [closed('weekend-phase', kind, detail)], 'car-status': slots.map((s) => closed('car-status', 'competing', undefined, s)) };
  return {
    sessionUid: uid,
    weekendId: 'w1',
    playerCar: carId(0),
    cars: slots.map((s) => ({ carId: carId(s), carKey: seatsOf[s]! })),
    projection: history({ ...lists, spans: { ...lists.spans, ...spans } }),
  };
}

/** A qualifying session of `seatsOf` with `laps`. */
export const qualifying = (uid: string, laps: LapRecord[], seatsOf: Record<number, CarKey>, phase: WeekendPhase = { kind: 'qualifying', format: 'grandPrix', segment: 3 }): StoredSession =>
  stored(uid, phase, seatsOf, { laps });

/** The basis context of a session whose player car has seat `KEY(0)`, with `sessions` loaded (none: `sessions: []`). */
export const basisOf = (sessions: StoredSession[]): BasisContext => ({ basis: { practice: [], qualifying: null }, player: KEY(0), sessions });

/**
 * The view of the current session (default: the race before its first lap): `seats` as the live state's identities,
 * its own `lists`, `view.basis` as given (absent: none), the config, degradation's output on it.
 */
export function viewOf(o: { seats: Record<number, CarKey>; basis?: BasisContext; phase?: WeekendPhase; lists?: Partial<Projection>; config?: EngineView['config'] }): EngineView {
  const cars = Object.entries(o.seats).map(([slot, k]) => carState({ id: carId(Number(slot)), identity: { teamId: k.teamId, raceNumber: k.raceNumber }, updatedAt: { participants: 0 } }));
  const base = situatedView({ cars, phase: o.phase ?? RACE, history: o.lists ?? {}, ...(o.config !== undefined && { config: o.config }) });
  const view: EngineView = { ...base, basis: o.basis };
  return { ...view, outputs: new Map([[DEGRADATION, degradationCalculator.compute(view)]]) };
}

type Pace = WeekendPace[CarId] extends Known<infer T> ? T : never;

/** Car `car`'s known pace; throws on an unknown or a missing entry. */
export const valueOf = (out: WeekendPace, car: number): Pace => {
  const k = out[carId(car)];
  if (k === undefined) throw new Error(`car ${car}: no entry`);
  if (!k.known) throw new Error(`car ${car}: unknown(${k.reason})`);
  return k.value;
};

export const INSUFFICIENT = unknown('insufficientData');
