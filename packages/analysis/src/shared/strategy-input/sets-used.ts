// One set rule (SP4.3e Task 3, spec §4.4 item 5; C43, C50): the sets a policy uses from a starting point. A free start
// (`start.start.freeCompound[car]` 1) takes a new set of its start compound unless only used ones exist (then a used
// one); a car on its tyres takes none; each stop takes a new set. `followable` and the DP's input read it, so the Monte
// Carlo never plays a plan the DP holds impossible. Pure (C2).
import { NOISE_COMPOUNDS, type CarId, type NoiseCompound, type Policy, type StartingPoint } from '@pitwall/domain';

/** Car `car`'s new sets per compound in `start` (`wearPct` 0): the sets a stop can take. */
export function newSetsOf(start: StartingPoint, car: CarId): Record<NoiseCompound, number> {
  const out = Object.fromEntries(NOISE_COMPOUNDS.map((c) => [c, 0])) as Record<NoiseCompound, number>;
  for (const s of start.sets[car] ?? []) if (s.wearPct <= 0) out[s.compound] += 1;
  return out;
}

/**
 * The sets car `car` takes for a free start on `startCompound` (none: not free, or no start compound) and `stops`, in
 * order: per stop whether it finds a new set (`kept`); whether the free start finds any set (`startOk`); each compound
 * short of a set once, in the order first missed (`missing`).
 */
export function takeSets(start: StartingPoint, car: CarId, startCompound: NoiseCompound | undefined, stops: Policy['stops']): { startOk: boolean; kept: boolean[]; missing: NoiseCompound[] } {
  const fresh = newSetsOf(start, car);
  const missing: NoiseCompound[] = [];
  const miss = (c: NoiseCompound) => {
    if (!missing.includes(c)) missing.push(c);
  };
  let startOk = true;
  if (startCompound !== undefined && start.start != null && start.start.freeCompound[car] === 1) {
    if (fresh[startCompound] > 0) fresh[startCompound] -= 1;
    else if (!(start.sets[car] ?? []).some((s) => s.compound === startCompound)) {
      startOk = false;
      miss(startCompound);
    }
  }
  const kept = stops.map((s) => {
    if (fresh[s.compound] <= 0) {
      miss(s.compound);
      return false;
    }
    fresh[s.compound] -= 1;
    return true;
  });
  return { startOk, kept, missing };
}

/** Whether the sets policy `policy` uses from `start` are there for car `car`, and which compounds are missing. */
export function setsUsed(start: StartingPoint, car: CarId, policy: Policy): { ok: boolean; missing: NoiseCompound[] } {
  const { missing } = takeSets(start, car, policy.startCompound, policy.stops);
  return { ok: missing.length === 0, missing };
}
