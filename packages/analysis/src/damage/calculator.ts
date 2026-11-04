// The `damage` calculator: per car, the damage now and its jumps from the shared grouping of the `damageChange` events
// (`shared/damage-jumps.ts`) and the laps; it shows only the jumps whose part was not repaired (a fall) since.
import {
  addLaps,
  emptyCurrentLaps,
  known,
  unknown,
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
import { behaviourFor } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { emptyDamageJumps, finishJump, foldDamageJumps, repairedSince, type DamageJumpFold } from '../shared/damage-jumps.ts';
import { DAMAGE_BEHAVIOUR, type DamageEffect } from './behaviour.ts';
import { DAMAGE, DAMAGE_CONFIG, type DamageOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

type Acc = {
  /** The shared jump grouping over the events folded so far. */
  grouping: DamageJumpFold;
  /** Laps folded so far. */
  lapCount: number;
  /** One record per (car, lap): confirmed over provisional. */
  laps: CurrentLaps;
  jumpPct: number;
  jumpWindowMs: number;
  maxNeutralisedMs: number;
  window: number;
};

const settings = (view: EngineView) => ({
  ...DAMAGE_CONFIG.read(view),
  ...LAP_CLASSES_CONFIG.read(view),
  window: PACE_CONFIG.read(view).window,
});

const foldLaps = (acc: Acc, view: EngineView): void => {
  const { laps } = view.history;
  addLaps(acc.laps, laps.slice(acc.lapCount) as LapRecord[]);
  acc.lapCount = laps.length;
};

/** A pending weekend phase has no span yet and reads as the race's grid (C14): its row is the race's. */
const GRID = DAMAGE_BEHAVIOUR['weekend-phase']?.race;

/**
 * Per car in the session: its state now without the jumps, its current lap, and its rows (`DAMAGE_BEHAVIOUR`), from the
 * live state and the open spans. Read by `output`, never kept in the accumulator (C31.2).
 */
const carsNow = (view: EngineView): Map<CarId, { state: Omit<DamageState, 'jumps'>; lap: number; effect: DamageEffect }> => {
  const now = new Map<CarId, { state: Omit<DamageState, 'jumps'>; lap: number; effect: DamageEffect }>();
  for (const car of view.live.cars) {
    const effect: DamageEffect = Object.assign({}, GRID, ...behaviourFor(DAMAGE_BEHAVIOUR, view, car.id));
    if (effect.inSession !== true) continue;
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
    now.set(car.id, {
      state: { parts, corners, drsFault: car.condition.drsFault, ersFault: car.condition.ersFault },
      lap: car.timing.lap,
      effect,
    });
  }
  return now;
};

/** A pure fold over the events, the laps and the config (C31.2). */
const fold = (acc: Acc, view: EngineView): Acc => {
  foldDamageJumps(acc.grouping, view.history.events, acc);
  foldLaps(acc, view);
  return acc;
};

const init = (view: EngineView): Acc =>
  fold({ grouping: emptyDamageJumps(), lapCount: 0, laps: emptyCurrentLaps(), ...settings(view) }, view);

/**
 * Damage now and its jumps not repaired since, per car in the session; a jump's loss is `pace-delta` over the pace laps
 * around it, `notApplicable` where the weekend phase has none to measure (`DAMAGE_BEHAVIOUR`).
 */
export const damageCalculator: IncrementalCalculator<Acc, DamageOutput> = {
  id: DAMAGE,
  kind: 'incremental',
  reads: ['condition', 'tyres', 'timing', 'events', 'laps', CAR_STATUS_READS, 'spans:car-location', 'spans:weekend-phase'],
  cadence: { hz: 4 },
  init,
  update: (acc, delta, view) => (delta.rewound !== undefined ? init(view) : fold(acc, view)),
  output(acc, view) {
    const out: DamageOutput = {};
    for (const [id, { state, lap, effect }] of carsNow(view)) {
      // integer keys iterate in ascending order: the car's laps by lap number
      const laps = Object.values(acc.laps[id] ?? {});
      const opts = { ...acc, isRace: effect.isRace === true };
      const jumps = (acc.grouping.jumps.get(id) ?? [])
        .filter((raw) => !repairedSince(acc.grouping, id, raw))
        .map((raw) => finishJump(raw, laps, lap, opts))
        .map((jump) => (effect.measured === true ? jump : { ...jump, lossMsPerLap: unknown('notApplicable') }));
      out[id] = { ...state, jumps };
    }
    return out;
  },
};
