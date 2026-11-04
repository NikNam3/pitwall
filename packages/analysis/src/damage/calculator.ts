// The `damage` calculator: per car, the damage now and its jumps from the shared grouping of the `damageChange` events
// (`shared/damage-jumps.ts`) and the laps; it shows only the jumps whose part was not repaired (a fall) since.
import {
  addLaps,
  emptyCurrentLaps,
  known,
  type CarId,
  type Corners,
  type CurrentLaps,
  type DamageParts,
  type DamageState,
  type LapRecord,
} from '@pitwall/domain';
import type { EngineView, IncrementalCalculator } from '@pitwall/engine/readers';
import { LAP_CLASSES_CONFIG } from '../lap-classes/index.ts';
import { PACE_CONFIG } from '../pace/index.ts';
import { emptyDamageJumps, finishJump, foldDamageJumps, repairedSince, type DamageJumpFold } from '../shared/damage-jumps.ts';
import { DAMAGE, DAMAGE_CONFIG, type DamageOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

type Acc = {
  /** The shared jump grouping over the events folded so far. */
  grouping: DamageJumpFold;
  /** Laps folded so far. */
  lapCount: number;
  /** One record per (car, lap): confirmed over provisional. */
  laps: CurrentLaps;
  /** Per active car: its state now without the jumps, and its current lap. */
  now: Map<CarId, { state: Omit<DamageState, 'jumps'>; lap: number }>;
  jumpPct: number;
  jumpWindowMs: number;
  isRace: boolean;
  maxNeutralisedMs: number;
  window: number;
};

const settings = (view: EngineView) => ({
  ...DAMAGE_CONFIG.read(view),
  isRace: view.live.session.kind === 'race',
  ...LAP_CLASSES_CONFIG.read(view),
  window: PACE_CONFIG.read(view).window,
});

const foldLaps = (acc: Acc, view: EngineView): void => {
  const { laps } = view.history;
  addLaps(acc.laps, laps.slice(acc.lapCount) as LapRecord[]);
  acc.lapCount = laps.length;
};

const foldCars = (acc: Acc, view: EngineView): void => {
  acc.now.clear();
  for (const car of view.live.cars) {
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
  foldDamageJumps(acc.grouping, view.history.events, acc);
  foldLaps(acc, view);
  foldCars(acc, view);
  return acc;
};

const init = (view: EngineView): Acc =>
  fold(
    { grouping: emptyDamageJumps(), lapCount: 0, laps: emptyCurrentLaps(), now: new Map(), ...settings(view) },
    view,
  );

/** Damage now and its jumps not repaired since per active car; a jump's loss is `pace-delta` over the pace laps around it. */
export const damageCalculator: IncrementalCalculator<Acc, DamageOutput> = {
  id: DAMAGE,
  kind: 'incremental',
  reads: ['condition', 'tyres', 'events', 'laps'],
  cadence: { hz: 4 },
  init,
  update: (acc, delta, view) => (delta.rewound !== undefined ? init(view) : fold(acc, view)),
  output(acc) {
    const out: DamageOutput = {};
    for (const [id, { state, lap }] of acc.now) {
      // integer keys iterate in ascending order: the car's laps by lap number
      const laps = Object.values(acc.laps[id] ?? {});
      const jumps = (acc.grouping.jumps.get(id) ?? [])
        .filter((raw) => !repairedSince(acc.grouping, id, raw))
        .map((raw) => finishJump(raw, laps, lap, acc));
      out[id] = { ...state, jumps };
    }
    return out;
  },
};
