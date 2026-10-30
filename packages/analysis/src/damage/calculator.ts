// The `damage` calculator: per car, the damage now and the jumps folded from the `damageChange` events and the laps;
// a fall of a part (a repair) clears that part's jumps.
import {
  addLaps,
  emptyCurrentLaps,
  known,
  type CarId,
  type Corners,
  type CurrentLaps,
  type DamageChangeParams,
  type DamageJump,
  type DamageParts,
  type DamageState,
  type LapRecord,
  type SessionTime,
} from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine';
import { PACE_CONFIG } from '../pace/index.ts';
import { paceDeltaAround } from '../pace-delta/index.ts';
import { DAMAGE, DAMAGE_CONFIG, type DamageOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/** Rises of one part so far inside the window that opened at `start`. */
type Cluster = { start: SessionTime; sumPct: number };

/** A jump before its lap and loss are known. */
type RawJump = { at: SessionTime; part: keyof DamageParts; deltaPct: number };

type Acc = {
  /** Events folded so far. */
  events: number;
  /** Laps folded so far. */
  lapCount: number;
  clusters: Map<string, Cluster>;
  jumps: Map<CarId, RawJump[]>;
  /** One record per (car, lap): confirmed over provisional. */
  laps: CurrentLaps;
  /** Per active car: its state now without the jumps, and its current lap. */
  now: Map<CarId, { state: Omit<DamageState, 'jumps'>; lap: number }>;
  jumpPct: number;
  jumpWindowMs: number;
  isRace: boolean;
  window: number;
};

const settings = (view: EngineView) => ({
  ...DAMAGE_CONFIG.read(view),
  isRace: view.state.session.kind === 'race',
  window: PACE_CONFIG.read(view).window,
});

/** A fall of a part is a repair: the car's jumps of that part and its open cluster of that part are gone. */
const repair = (acc: Acc, carId: CarId, part: keyof DamageParts, key: string): void => {
  acc.clusters.delete(key);
  const list = acc.jumps.get(carId);
  if (list !== undefined) acc.jumps.set(carId, list.filter((j) => j.part !== part));
};

const foldEvents = (acc: Acc, view: EngineView): void => {
  const { events } = view.state.history;
  for (let i = acc.events; i < events.length; i++) {
    const e = events[i];
    if (e === undefined || e.kind !== 'damageChange' || e.carId === undefined) continue;
    const { part, fromPct, toPct } = e.params as unknown as DamageChangeParams;
    const rise = toPct - fromPct;
    const key = `${e.carId}:${part}`;
    if (rise <= 0) {
      repair(acc, e.carId, part, key);
      continue;
    }
    const open = acc.clusters.get(key);
    const cluster = open !== undefined && e.at - open.start <= acc.jumpWindowMs ? open : { start: e.at, sumPct: 0 };
    cluster.sumPct += rise;
    if (cluster.sumPct >= acc.jumpPct) {
      acc.clusters.delete(key);
      const list = acc.jumps.get(e.carId) ?? [];
      list.push({ at: e.at, part, deltaPct: cluster.sumPct });
      acc.jumps.set(e.carId, list);
    } else acc.clusters.set(key, cluster);
  }
  acc.events = events.length;
};

const foldLaps = (acc: Acc, view: EngineView): void => {
  const { laps } = view.state.history;
  addLaps(acc.laps, laps.slice(acc.lapCount) as LapRecord[]);
  acc.lapCount = laps.length;
};

const foldCars = (acc: Acc, view: EngineView): void => {
  acc.now.clear();
  for (const car of view.state.cars) {
    if (!car.active) continue;
    const { bodywork, powerUnit } = car.condition;
    const parts: DamageState['parts'] = !bodywork.known
      ? bodywork
      : !powerUnit.known
        ? powerUnit
        : known<DamageParts>(
            { ...bodywork.value, gearboxPct: powerUnit.value.gearboxDamagePct, enginePct: powerUnit.value.engineDamagePct },
            Math.max(bodywork.at, powerUnit.at),
          );
    const corner = (c: (typeof CORNERS)[number]) => ({
      tyrePct: car.tyres.corners[c].damagePct,
      brakePct: car.condition.brakes[c].damagePct,
    });
    const corners = Object.fromEntries(CORNERS.map((c) => [c, corner(c)])) as Corners<DamageState['corners']['fl']>;
    acc.now.set(car.id, {
      state: { parts, corners, drsFault: car.condition.drsFault, ersFault: car.condition.ersFault },
      lap: car.timing.lap,
    });
  }
};

const fold = (acc: Acc, view: EngineView): Acc => {
  Object.assign(acc, settings(view));
  foldEvents(acc, view);
  foldLaps(acc, view);
  foldCars(acc, view);
  return acc;
};

const init = (view: EngineView): Acc =>
  fold(
    { events: 0, lapCount: 0, clusters: new Map(), jumps: new Map(), laps: emptyCurrentLaps(), now: new Map(), ...settings(view) },
    view,
  );

/** The jump with its lap and its measured loss: `pace-delta` over the pace laps around the jump's lap. */
const finishJump = (acc: Acc, raw: RawJump, laps: LapRecord[], currentLap: number): DamageJump => {
  const lap = laps.find((l) => l.completedAt >= raw.at)?.lapNumber ?? currentLap;
  return { at: raw.at, lap, parts: [raw.part], deltaPct: raw.deltaPct, lossMsPerLap: paceDeltaAround(laps, lap, acc) };
};

/** Damage now and its jumps per active car; a jump's loss is `pace-delta` over the pace laps around it. */
export const damageCalculator: IncrementalCalculator<Acc, DamageOutput> = {
  id: DAMAGE,
  kind: 'incremental',
  reads: ['condition', 'tyres', 'events', 'laps'],
  cadence: { hz: 4 },
  init,
  update: (acc, delta, view) => (delta.truncated ? init(view) : fold(acc, view)),
  output(acc) {
    const out: DamageOutput = {};
    for (const [id, { state, lap }] of acc.now) {
      // integer keys iterate in ascending order: the car's laps by lap number
      const laps = Object.values(acc.laps[id] ?? {});
      const jumps = (acc.jumps.get(id) ?? []).map((raw) => finishJump(acc, raw, laps, lap));
      out[id] = { ...state, jumps };
    }
    return out;
  },
};
