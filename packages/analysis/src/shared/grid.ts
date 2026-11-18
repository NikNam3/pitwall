// The race's grid from qualifying (SP4.3d2 Task 7, spec §7.0 rule 5, §7.2; contract C3, C25, C62): the session's cars
// by their best valid lap; in a long format's later segment (Q3, SQ3) the cars eliminated in each earlier segment of the
// same qualifying format follow, from the weekend's newest stored session of that segment (a league restart's newest
// attempt), matched to this session's slots by team and race number; cars without a valid time last, in car order.
import { carStatusSpans, currentLaps, known, unknown, weekendPhaseSpans, type CarId, type CarKey, type Known, type LapRecord, type QualifyingPhaseDetail } from '@pitwall/domain';
import type { AsOfView, DeepReadonly, StoredSession } from '@pitwall/engine/readers';

/** One car's best valid lap: its time and when it was completed (the earlier one first on a tie). */
type Best = { ms: number; at: number; frame: number };

/** Per car slot its best valid lap over the current lap records (C25). */
function bestValidLaps(laps: readonly LapRecord[]): Map<CarId, Best> {
  const out = new Map<CarId, Best>();
  for (const l of currentLaps(laps)) {
    if (!l.valid.lap || !(l.lapTimeMs > 0)) continue;
    const held = out.get(l.carId);
    if (held === undefined || before({ ms: l.lapTimeMs, at: l.completedAt, frame: l.frame }, held)) out.set(l.carId, { ms: l.lapTimeMs, at: l.completedAt, frame: l.frame });
  }
  return out;
}

/** Whether `a` ranks ahead of `b`: the faster lap, on a tie the earlier one. */
const before = (a: Best, b: Best): boolean => a.ms < b.ms || (a.ms === b.ms && (a.at < b.at || (a.at === b.at && a.frame < b.frame)));

/** `cars` ranked by `best` (each car in it), ahead first. */
const ranked = (best: ReadonlyMap<CarId, Best>): CarId[] => [...best.keys()].sort((a, b) => (before(best.get(a) as Best, best.get(b) as Best) ? -1 : before(best.get(b) as Best, best.get(a) as Best) ? 1 : a - b));

const keyOf = (k: DeepReadonly<CarKey>): string => `${k.teamId}:${k.raceNumber}`;

/** A stored session's qualifying format and segment (its weekend-phase span), `undefined` for any other phase. */
function qualifyingOf(session: DeepReadonly<StoredSession>): QualifyingPhaseDetail | undefined {
  const span = (session.projection.spans[weekendPhaseSpans.machine] ?? []).at(-1);
  return span?.kind === 'qualifying' ? (span.detail as QualifyingPhaseDetail) : undefined;
}

/**
 * A stored session's cars by their best valid lap there, as this session's slots (`slotOf` by team and race number,
 * C62): a stored slot without a key, or whose key no slot of this session carries, is left out.
 */
function storedOrder(session: DeepReadonly<StoredSession>, slotOf: ReadonlyMap<string, CarId>): CarId[] {
  const stored = new Map<CarId, string>(session.cars.map((c) => [c.carId, keyOf(c.carKey)]));
  const out: CarId[] = [];
  for (const car of ranked(bestValidLaps(session.projection.laps as readonly LapRecord[]))) {
    const key = stored.get(car);
    const slot = key === undefined ? undefined : slotOf.get(key);
    if (slot !== undefined) out.push(slot);
  }
  return out;
}

/**
 * The race's grid from the qualifying session of `view` (spec §7.0 rule 5): its cars (car-status other than `absent`,
 * C17) by their best valid lap (`currentLaps`, C25; earlier lap first on a tie); in a later segment of a long format,
 * per earlier segment (newest segment first) the newest stored session of the weekend of that segment and the same
 * qualifying format (`view.basis`, C62), its cars not yet placed by their best valid lap there, matched by team and
 * race number (`fixed.carKeys`, each stored session's `cars`); then the cars without a valid time, in car order.
 * `notApplicable` outside qualifying (C3).
 */
export function gridOf(view: AsOfView): Known<CarId[]> {
  const phase = view.situation.weekendPhase;
  if (phase.kind !== 'qualifying') return unknown('notApplicable');
  const cars: CarId[] = [];
  for (const span of view.situation.byMachine[carStatusSpans.machine] ?? []) if (span.carId !== undefined && span.kind !== 'absent' && !cars.includes(span.carId)) cars.push(span.carId);
  cars.sort((a, b) => a - b);
  const inSession = new Set(cars);

  const grid: CarId[] = [];
  const placed = new Set<CarId>();
  const place = (order: readonly CarId[]): void => {
    for (const car of order) {
      if (!inSession.has(car) || placed.has(car)) continue;
      placed.add(car);
      grid.push(car);
    }
  };
  place(ranked(bestValidLaps(view.history.laps as readonly LapRecord[])));

  const segment = phase.segment;
  const keys = view.fixed.carKeys;
  if (segment !== undefined && segment > 1 && keys.known && view.basis !== undefined) {
    const slotOf = new Map<string, CarId>();
    keys.value.forEach((k, slot) => {
      if (k !== null) slotOf.set(keyOf(k), slot as CarId);
    });
    for (let s = segment - 1; s >= 1; s--) {
      const session = view.basis.sessions.findLast((x) => {
        const q = qualifyingOf(x);
        return q !== undefined && q.format === phase.format && q.segment === s;
      });
      if (session !== undefined) place(storedOrder(session, slotOf));
    }
  }
  place(cars);
  return known(grid, view.at);
}
