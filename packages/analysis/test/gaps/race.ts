// Test races for `gaps`: mini-sector histories with car states that agree with them (position, lap, total distance).
import { carId, MINI_SECTORS, type CarId, type CarState, type MiniSectorCrossing, type ResultStatus, type SessionKind } from '@pitwall/domain';
import { historyLengths, type EngineView } from '@pitwall/engine';
import { carState, crossings, engineView, event } from '../../../../test-support/builders/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import type { GapsOutput } from '../../src/gaps/index.ts';

/** The default race session's track length (`engineView`). */
export const TRACK_M = 5000;
const SEGMENT_M = TRACK_M / MINI_SECTORS;

/** Mini-sectors a car has completed at this crossing, counted from the start. */
export const progressOf = (m: Pick<MiniSectorCrossing, 'lap' | 'segment'>): number => (m.lap - 1) * MINI_SECTORS + m.segment + 1;

/** Sorted by time, ties by car id: the order the history appends them in. */
export const byTime = (list: MiniSectorCrossing[]): MiniSectorCrossing[] =>
  [...list].sort((a, b) => a.at - b.at || a.carId - b.carId);

/** Every car runs `laps` laps at `paceMs`, car `i` starting `offsetsMs[i]` after 0: car i is `offsetsMs[i] - offsetsMs[j]` behind car j everywhere. */
export function offsetRace(offsetsMs: number[], laps: number, paceMs = 90_000): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  offsetsMs.forEach((offset, i) => {
    for (let n = 1; n <= laps; n++) list.push(...crossings(carId(i), n, paceMs, offset + (n - 1) * paceMs));
  });
  return byTime(list);
}

export type CarOverride = { position?: number; resultStatus?: ResultStatus };

/**
 * One car state per car that has a crossing (plus the overridden ones), agreeing with the history: the lap it is on,
 * the total distance at its latest crossing, and the position by distance (ties: the earlier crossing first, then id).
 * `over` sets a car's position or result status instead.
 */
export function carsFor(miniSectors: MiniSectorCrossing[], over: Record<number, CarOverride> = {}): CarState[] {
  const latest = new Map<CarId, MiniSectorCrossing>();
  for (const m of miniSectors) latest.set(m.carId, m);
  const ids = [...new Set([...latest.keys(), ...Object.keys(over).map((k) => carId(Number(k)))])];
  const progress = (id: CarId) => (latest.has(id) ? progressOf(latest.get(id)!) : 0);
  const at = (id: CarId) => latest.get(id)?.at ?? Number.POSITIVE_INFINITY;
  const order = [...ids].sort((a, b) => progress(b) - progress(a) || at(a) - at(b) || a - b);
  return ids.map((id) => {
    const last = latest.get(id);
    return carState({
      id,
      timing: {
        position: over[id]?.position ?? order.indexOf(id) + 1,
        lap: last === undefined ? 1 : last.segment === MINI_SECTORS - 1 ? last.lap + 1 : last.lap,
        lapDistanceM: last === undefined ? 0 : ((last.segment + 1) % MINI_SECTORS) * SEGMENT_M,
        totalDistanceM: progress(id) * SEGMENT_M,
        resultStatus: over[id]?.resultStatus ?? 'active',
      },
    });
  });
}

/**
 * The race view over these crossings, every crossing new; `cars` default to `carsFor(miniSectors)`. The lights go out
 * at `lightsOutAt` (default 0, as `field` starts); `null` means not yet.
 */
export const viewOf = (
  miniSectors: MiniSectorCrossing[],
  {
    cars,
    playerCar = 0,
    config = {},
    lightsOutAt = 0,
    kind = 'race',
  }: { cars?: CarState[]; playerCar?: number; config?: EngineView['config']; lightsOutAt?: number | null; kind?: SessionKind } = {},
): EngineView =>
  engineView({
    cars: cars ?? carsFor(miniSectors),
    history: { miniSectors, events: lightsOutAt === null ? [] : [event({ kind: 'lightsOut', at: lightsOutAt })] },
    playerCar,
    config,
    session: { kind },
  });

/** `init` over the view, as on a fresh run. */
export const run = (view: EngineView): GapsOutput => gapsCalculator.output(gapsCalculator.init(view));

/** The delta from one view's history to the next one's. */
export const deltaOf = (from: EngineView, to: EngineView, truncated = false) => ({
  before: historyLengths(from.state.history),
  after: historyLengths(to.state.history),
  truncated,
});

/** Turns -0 into 0 so `toEqual` compares the number, not its sign bit. */
export const plain = (n: number): number => n + 0;
