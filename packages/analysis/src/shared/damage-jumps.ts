// The damage jump grouping from the history's `damageChange` events, shared by `damage` (the card and the alarm: the
// jumps not repaired since) and `incidents` (the feed, a log: every jump).
import type { CarId, DamageChangeParams, DamageJump, DamageParts, FrameNumber, LapRecord, RaceEvent, SessionTime } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { paceDeltaAround, type PaceDeltaOptions } from '../pace-delta/index.ts';

/** The `damage` config's thresholds of a jump. */
export type DamageJumpOptions = { jumpPct: number; jumpWindowMs: number };

/** A jump of one part before its lap and loss are known: at the event that reached `jumpPct`, with the summed rise. */
export type RawDamageJump = { at: SessionTime; part: keyof DamageParts; deltaPct: number };

/** Per car, its jumps in event order, and per part the times of its repairs (falls) in event order. */
export type DamageJumps = {
  jumps: Map<CarId, RawDamageJump[]>;
  repairs: Map<CarId, Map<keyof DamageParts, SessionTime[]>>;
};

/** Rises of one part so far inside the window that opened at `start`. */
type Cluster = { start: SessionTime; sumPct: number };

/**
 * The grouping folded over the first `folded` events, for an incremental caller; `frames`: per car, the frame each of
 * its jumps describes (the event that reached `jumpPct`, C26), by the jump's index in `jumps`.
 */
export type DamageJumpFold = DamageJumps & { folded: number; clusters: Map<string, Cluster>; frames: Map<CarId, FrameNumber[]> };

type Event = Pick<RaceEvent, 'at' | 'kind' | 'carId' | 'params' | 'frame'>;

export const emptyDamageJumps = (): DamageJumpFold => ({ jumps: new Map(), repairs: new Map(), folded: 0, clusters: new Map(), frames: new Map() });

/**
 * Folds the events after the `folded` ones into `fold`. Rises of one part of a car add up within `jumpWindowMs` of the
 * first one; once they reach `jumpPct` they are a jump, which closes the window. A fall (a part change in the pits) is
 * a repair of that part: it closes the part's open window and keeps every jump.
 */
export function foldDamageJumps(fold: DamageJumpFold, events: readonly DeepReadonly<Event>[], opts: DamageJumpOptions): void {
  for (let i = fold.folded; i < events.length; i++) {
    const e = events[i];
    if (e === undefined || e.kind !== 'damageChange' || e.carId === undefined) continue;
    const { part, fromPct, toPct } = e.params as unknown as DamageChangeParams;
    const rise = toPct - fromPct;
    const key = `${e.carId}:${part}`;
    if (rise <= 0) {
      fold.clusters.delete(key);
      const parts = fold.repairs.get(e.carId) ?? new Map<keyof DamageParts, SessionTime[]>();
      fold.repairs.set(e.carId, parts);
      const times = parts.get(part) ?? [];
      parts.set(part, times);
      times.push(e.at);
      continue;
    }
    const open = fold.clusters.get(key);
    const cluster = open !== undefined && e.at - open.start <= opts.jumpWindowMs ? open : { start: e.at, sumPct: 0 };
    cluster.sumPct += rise;
    if (cluster.sumPct >= opts.jumpPct) {
      fold.clusters.delete(key);
      const list = fold.jumps.get(e.carId) ?? [];
      fold.jumps.set(e.carId, list);
      list.push({ at: e.at, part, deltaPct: cluster.sumPct });
      const frames = fold.frames.get(e.carId) ?? [];
      fold.frames.set(e.carId, frames);
      frames.push(e.frame);
    } else fold.clusters.set(key, cluster);
  }
  fold.folded = events.length;
}

/** The jumps and repairs of `events` (the history's event list, in order). */
export function damageJumps(events: readonly DeepReadonly<Event>[], opts: DamageJumpOptions): DamageJumps {
  const fold = emptyDamageJumps();
  foldDamageJumps(fold, events, opts);
  return { jumps: fold.jumps, repairs: fold.repairs };
}

/** Whether the jump's part of car `carId` was repaired after the jump. */
export const repairedSince = (grouping: DamageJumps, carId: CarId, jump: RawDamageJump): boolean =>
  (grouping.repairs.get(carId)?.get(jump.part) ?? []).some((t) => t > jump.at);

/**
 * The jump with its lap and its measured loss: the lap is the car's first lap completed at or after the jump, else
 * `currentLap`; the loss is `pace-delta` over the car's pace laps around that lap. `laps` holds one record per lap, by lap number.
 */
export function finishJump(
  raw: RawDamageJump,
  laps: readonly DeepReadonly<LapRecord>[],
  currentLap: number,
  opts: PaceDeltaOptions,
): DamageJump {
  const lap = laps.find((l) => l.completedAt >= raw.at)?.lapNumber ?? currentLap;
  return { at: raw.at, lap, parts: [raw.part], deltaPct: raw.deltaPct, lossMsPerLap: paceDeltaAround(laps, lap, opts) };
}
