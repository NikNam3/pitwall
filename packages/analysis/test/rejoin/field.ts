// Built races for `rejoin` (SP4.2 spec 3.2): every car laps at one pace from its own start offset, so the gap of any two
// cars at the same point of the road is the difference of their offsets, exact to the ms. `gaps` runs on the crossings
// (its own calculator, through its guarded view), `pit-loss`'s output is given per condition, and `rejoin` sees both
// as upstream outputs on the same view, with our cars' car-activity-race spans open (C20). The live state is the
// frame's at `now` (SP4.3d1 Task 7): `sessionTime` is `now` and every car's lap, lap distance and total distance are
// where it is at `now` (between two of its crossings), so a car's live progress against our crossing history gives its
// gap exactly. A stopped car (`stopped`) records no crossing after it stops and stays where it stopped.
import { carId, known, unknown, type EstimateSource, type Known, type MiniSectorCrossing, type Ms, type OpenSpan, type PitCondition, type PitLosses, type PitLossEstimate, type TrackData } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { crossings } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { GAPS, type GapsOutput } from '../../src/gaps/index.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { byTime, carsFor, run, TRACK_M, viewOf, type Phase } from '../gaps/race.ts';
import { openSpan } from '../situated.ts';

/** Every car's lap. */
export const PACE: Ms = 90_000;
/** One mini-sector at `PACE`. */
export const SEGMENT_MS: Ms = PACE / 50;
/** Our car: the player's. */
export const US = 0;

/** Car id → its start offset in ms (the time it passes every point after the car with offset 0). */
export type Field = Record<number, number>;

/** A car that stops on the road at `at` and stays there: no crossing after `at`, its live progress that of `at`. */
export type Stopped = { car: number; at: number };

/** The time car `id` stops being at `now`: `now`, or its stop if it stopped before. */
const clockOf = (id: number, now: number, stopped: Stopped | undefined): number => (stopped !== undefined && stopped.car === id ? Math.min(now, stopped.at) : now);

/** Every crossing of the field at or before `now`; `without` lists cars with no crossing at all; `stopped` stops one. */
export function fieldCrossings(field: Field, now: number, without: readonly number[] = [], stopped?: Stopped): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  for (const [id, offset] of Object.entries(field).map(([k, v]) => [Number(k), v] as const)) {
    if (without.includes(id)) continue;
    const upTo = clockOf(id, now, stopped);
    for (let n = 1; offset + (n - 1) * PACE <= upTo; n++) list.push(...crossings(carId(id), n, PACE, offset + (n - 1) * PACE).filter((m) => m.at >= 0 && m.at <= upTo));
  }
  return byTime(list);
}

/** One mini-sector in metres on the views' track (`TRACK_M`). */
const SEGMENT_M = TRACK_M / 50;

/** Car `id`'s progress in mini-sectors at `now` (where it is, between two crossings), stopped where `stopped` says. */
export const progressNow = (field: Field, id: number, now: number, stopped?: Stopped): number => Math.max(0, (clockOf(id, now, stopped) - (field[id] ?? 0)) / SEGMENT_MS);

/**
 * The standard field at `NOW` (230 000): P1 to P5 (cars 1 to 5) 1 s apart ahead of us, we (car 0) P6 at offset 5 000,
 * behind us car 6 at +3.1 s (P7), car 7 +12.0 s (P8), car 8 +19.9 s (P9), car 9 +24.0 s (P10), car 10 +30.0 s (P11),
 * car 11 +35.0 s (P12). Our newest crossing is at 230 000 exactly (progress 125).
 */
export const FIELD: Field = { 1: 0, 2: 1_000, 3: 2_000, 4: 3_000, 5: 4_000, 0: 5_000, 6: 8_100, 7: 17_000, 8: 24_900, 9: 29_000, 10: 35_000, 11: 40_000 };
export const NOW = 230_000;

const SOURCE = (parts: string): EstimateSource => ({ kind: 'session', sessionShare: 1, parts });

/** One condition's pit-loss estimate with its own source. */
const estimate = (lossMs: Known<Ms>, source: EstimateSource): PitLossEstimate => ({ lossMs, inLapShare: unknown('notReceived'), stationaryMedianMs: known(2_500, 0), sessionStops: 2, source });

/** The sources `pitLosses` gives each condition, each its own. */
export const SOURCES: Record<PitCondition, EstimateSource> = {
  green: SOURCE('2 stops'),
  vsc: { kind: 'default', note: 'track file', sessionShare: 0, parts: 'track default' },
  sc: { kind: 'calibration', setName: 'set A', sources: 3, sessionShare: 0, parts: 'calibration' },
};

/** A loss: a number is known, a `Known` as given. */
export type Loss = number | Known<Ms>;
const asKnown = (l: Loss): Known<Ms> => (typeof l === 'number' ? known(l, 0) : l);

/** `pit-loss`'s output with these losses (default green 20 300, VSC 13 100, SC 9 800) and `SOURCES`. */
export function pitLosses(o: Partial<Record<PitCondition, Loss>> = {}): PitLosses {
  const { green = 20_300, vsc = 13_100, sc = 9_800 } = o;
  return {
    conditions: { green: estimate(asKnown(green), SOURCES.green), vsc: estimate(asKnown(vsc), SOURCES.vsc), sc: estimate(asKnown(sc), SOURCES.sc) },
    stops: [],
  };
}

export const ZANDVOORT: TrackData = zandvoortTrack();

/** What a rejoin view is built from. */
export type RejoinCase = {
  field?: Field;
  now?: number;
  /** Cars of the field with no crossing yet (they are still in the live state). */
  without?: number[];
  losses?: Partial<Record<PitCondition, Loss>>;
  /** Car-activity-race kind of each of our cars (default `racingLap`). */
  activity?: Record<number, string>;
  teammate?: number;
  kind?: Phase;
  track?: EngineView['track'];
  config?: EngineView['config'];
  /** One car stopped on the road from a time on (default none). */
  stopped?: Stopped;
};

/** The view `rejoin` sees, and the gaps output in it. */
export function rejoinCase(o: RejoinCase = {}): { view: EngineView; gaps: GapsOutput } {
  const field = o.field ?? FIELD;
  const now = o.now ?? NOW;
  const ms = fieldCrossings(field, now, o.without ?? [], o.stopped);
  const crossed = new Set(ms.map((m) => m.carId as number));
  // a car without a crossing is last; the others by distance; each car where it is at `now`
  const cars = carsFor(ms, Object.fromEntries((o.without ?? []).map((id) => [id, { position: Object.keys(field).length }]))).map((c) => {
    if (!crossed.has(c.id)) return c;
    const p = progressNow(field, c.id, now, o.stopped);
    return { ...c, timing: { ...c.timing, lap: Math.floor(p / 50) + 1, lapDistanceM: (p % 50) * SEGMENT_M, totalDistanceM: p * SEGMENT_M } };
  });
  const viewed = viewOf(ms, { cars, playerCar: US, ...(o.teammate !== undefined && { teammateCar: o.teammate }), kind: o.kind ?? 'race', config: o.config ?? {} });
  const base: EngineView = { ...viewed, live: { ...viewed.live, sessionTime: now } };
  const gaps = run(base);
  const ours = [US, ...(o.teammate === undefined ? [] : [o.teammate])];
  const activity: OpenSpan[] = ours.map((id) => openSpan('car-activity-race', o.activity?.[id] ?? 'racingLap', { car: id }));
  const view: EngineView = {
    ...base,
    situation: { ...base.situation, byMachine: { ...base.situation.byMachine, 'car-activity-race': activity } },
    outputs: new Map<string, unknown>([
      [GAPS, gaps],
      [PIT_LOSS, pitLosses(o.losses)],
    ]),
    track: o.track ?? known(ZANDVOORT, 0),
  };
  return { view, gaps };
}

export const NOT_APPLICABLE = unknown('notApplicable');
export const INSUFFICIENT = unknown('insufficientData');
