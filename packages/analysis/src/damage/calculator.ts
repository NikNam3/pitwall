// The `damage` calculator: per car, the damage now and the jumps folded from the `damageChange` events and the laps.
import {
  known,
  unknown,
  type CarId,
  type Corners,
  type DamageChangeParams,
  type DamageJump,
  type DamageParts,
  type DamageState,
  type LapRecord,
  type Ms,
  type SessionTime,
} from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { PACE_CONFIG } from '../pace/index.ts';
import { paceDelta } from '../pace-delta/index.ts';
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
  laps: Map<CarId, LapRecord[]>;
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

const foldEvents = (acc: Acc, view: EngineView): void => {
  const { events } = view.state.history;
  for (let i = acc.events; i < events.length; i++) {
    const e = events[i];
    if (e === undefined || e.kind !== 'damageChange' || e.carId === undefined) continue;
    const { part, fromPct, toPct } = e.params as unknown as DamageChangeParams;
    const rise = toPct - fromPct;
    if (rise <= 0) continue;
    const key = `${e.carId}:${part}`;
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
  for (let i = acc.lapCount; i < laps.length; i++) {
    const l = laps[i] as LapRecord | undefined;
    if (l === undefined) continue;
    const list = acc.laps.get(l.carId) ?? [];
    list.push(l);
    acc.laps.set(l.carId, list);
  }
  acc.lapCount = laps.length;
};

const foldCars = (acc: Acc, view: EngineView): void => {
  acc.now.clear();
  const at = view.state.sessionTime;
  for (const car of view.state.cars) {
    if (!car.active) continue;
    const { bodywork, powerUnit } = car.condition;
    const parts: DamageState['parts'] = !bodywork.known
      ? bodywork
      : !powerUnit.known
        ? powerUnit
        : known<DamageParts>(
            { ...bodywork.value, gearboxPct: powerUnit.value.gearboxDamagePct, enginePct: powerUnit.value.engineDamagePct },
            at,
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
    { events: 0, lapCount: 0, clusters: new Map(), jumps: new Map(), laps: new Map(), now: new Map(), ...settings(view) },
    view,
  );

/** The jump with its lap and its measured loss: pace laps before the jump's lap against pace laps after it. */
const finishJump = (acc: Acc, raw: RawJump, laps: LapRecord[], currentLap: number): DamageJump => {
  const lap = laps.find((l) => l.completedAt >= raw.at)?.lapNumber ?? currentLap;
  const paceLaps = laps.filter((l) => classifyLap(l, acc).forPace).sort((a, b) => a.lapNumber - b.lapNumber);
  const before = paceLaps.filter((l) => l.lapNumber < lap).slice(-acc.window);
  const after = paceLaps.filter((l) => l.lapNumber > lap).slice(0, acc.window);
  const last = after[after.length - 1];
  const lossMsPerLap =
    last === undefined
      ? unknown('insufficientData')
      : paceDelta(
          before.map((l) => l.lapTimeMs as Ms),
          after.map((l) => l.lapTimeMs as Ms),
          last.completedAt,
        );
  return { at: raw.at, lap, parts: [raw.part], deltaPct: raw.deltaPct, lossMsPerLap };
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
      const laps = acc.laps.get(id) ?? [];
      const jumps = (acc.jumps.get(id) ?? []).map((raw) => finishJump(acc, raw, laps, lap));
      out[id] = { ...state, jumps };
    }
    return out;
  },
};
