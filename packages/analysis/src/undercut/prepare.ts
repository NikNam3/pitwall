// `undercut`'s job input (SP4.3b spec §9.1; C41, C43, C51): the shared strategy input, and per our car the situation's
// row (`behaviour.ts`) and the rivals in range on the starting point with their place and signed gap; the call's
// config. Structured-cloneable.
import type { CarId, StartingPoint } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { RACE_INTERACTION_CONFIG } from '../race-interaction/config.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { configOf } from '../shared/config-of.ts';
import { strategyInputFrom, type StrategyInput } from '../shared/strategy-input/index.ts';
import { UNDERCUT_BEHAVIOUR } from './behaviour.ts';
import { UNDERCUT_CONFIG, type UndercutConfig } from './config.ts';

/** A rival in range: its place (1-based, running cars), its side and its signed gap to our car (positive = we ahead). */
export type UndercutRivalInput = { carId: CarId; side: 'ahead' | 'behind'; position: number; signedGapMs: number };

/** One of our cars: whether its situation lets the call run, its place, the rivals in range. */
export type UndercutCarInput = { applicable: boolean; position: number; rivals: UndercutRivalInput[] };

/** The call's config: `undercut`'s and the rivals' range, the one close gap, `race-interaction`'s `closeGapMs` (C43). */
export type UndercutJobConfig = UndercutConfig & { closeGapMs: number };

/** The job's input: `strategy`'s input, per our car its part, the call's config. */
export type UndercutInput = { strategy: StrategyInput; cars: Record<CarId, UndercutCarInput>; config: UndercutJobConfig };

/** The call's config of the run: `undercut`'s section over the defaults, and `race-interaction`'s close gap. */
const jobConfigOf = (view: Pick<EngineView, 'config'>): UndercutJobConfig => ({
  ...configOf(UNDERCUT_CONFIG, view),
  closeGapMs: RACE_INTERACTION_CONFIG.read(view).closeGapMs,
});

/**
 * Car `car`'s rivals on `start` (spec §9.1): the car directly ahead and directly behind within `rangeMs`, then the next
 * one each way within it, in place order; retired cars skipped. Its place is `position`.
 */
export function rivalsOf(start: StartingPoint, car: CarId, rangeMs: number): { position: number; rivals: UndercutRivalInput[] } {
  const order = Array.from(start.order).filter((k) => start.retired[k] !== 1);
  const i = order.indexOf(car);
  if (i < 0) return { position: start.cars, rivals: [] };
  const rivals: UndercutRivalInput[] = [];
  const take = (j: number, side: UndercutRivalInput['side']): boolean => {
    const k = order[j];
    if (k === undefined) return false;
    const signedGapMs = (start.gapMs[k] ?? 0) - (start.gapMs[car] ?? 0);
    if (Math.abs(signedGapMs) > rangeMs) return false;
    rivals.push({ carId: k as CarId, side, position: j + 1, signedGapMs });
    return true;
  };
  if (take(i - 1, 'ahead')) take(i - 2, 'ahead');
  if (take(i + 1, 'behind')) take(i + 2, 'behind');
  rivals.sort((a, b) => a.position - b.position);
  return { position: i + 1, rivals };
}

/** The job's input from the view. */
export function prepareUndercut(view: EngineView): UndercutInput {
  const strategy = strategyInputFrom(view);
  const config = jobConfigOf(view);
  const cars: Record<CarId, UndercutCarInput> = {};
  for (const car of strategy.ourCars) {
    const applicable = behaviourFor(UNDERCUT_BEHAVIOUR, view, car).every((row) => row === 'compute');
    const { position, rivals } = strategy.start.known ? rivalsOf(strategy.start.value, car, config.closeGapMs) : { position: 0, rivals: [] };
    cars[car] = { applicable, position, rivals };
  }
  return { strategy, cars, config };
}
