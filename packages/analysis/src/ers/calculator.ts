import { known } from '@pitwall/domain';
import type { CarId, CarState, ErsAttack, ErsState, Known, LapRecord } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { lapsUntil, perLapRate, PER_LAP_RATE_CONFIG } from '../per-lap-rate/index.ts';
import type { RateSample } from '../per-lap-rate/index.ts';
import { ERS, ERS_CONFIG } from './index.ts';
import type { ErsOutput } from './index.ts';

type View = Pick<EngineView, 'state' | 'config'>;

/** The laps of the car's current stint: after the last stint record unless that record still runs. */
function currentStintLaps(view: View, id: CarId): readonly LapRecord[] {
  const { laps, stints } = view.state.history;
  // the view is deep-readonly; the records are only read
  const mine = (laps as readonly LapRecord[]).filter((l) => l.carId === id);
  const last = stints.filter((s) => s.carId === id).at(-1);
  if (last === undefined) return mine;
  const newest = mine.reduce((m, l) => Math.max(m, l.lapNumber), 0);
  return last.lastLap >= newest ? mine : mine.filter((l) => l.lapNumber > last.lastLap);
}

/** The store at the end of each lap of the current stint that counts for a rate, oldest first. */
function trendSamples(view: View, id: CarId): RateSample[] {
  const isRace = view.state.session.kind === 'race';
  return currentStintLaps(view, id)
    .filter((l) => classifyLap(l, { isRace }).forRate && l.ersStoreAtEndJ.known)
    .sort((a, b) => a.lapNumber - b.lapNumber)
    .flatMap((l) => (l.ersStoreAtEndJ.known ? [{ lap: l.lapNumber, value: l.ersStoreAtEndJ.value, at: l.completedAt }] : []));
}

function flowOf(power: CarState['energy']['power']): ErsState['flow'] {
  if (!power.known) return power;
  const { mgukW } = power.value;
  return known(mgukW > 0 ? 'deploying' : mgukW < 0 ? 'harvesting' : 'idle', power.at);
}

/** Ready at or above the level (as of the reading); below it, the laps to the level rounded up to whole laps, at least 1. */
function attackOf(storeJ: Known<number>, attackLevelJ: number, lapsToLevel: Known<number>): Known<ErsAttack> {
  if (!storeJ.known) return storeJ;
  if (storeJ.value >= attackLevelJ) return known({ ready: true }, storeJ.at);
  if (!lapsToLevel.known) return lapsToLevel;
  return known({ ready: false, inLaps: Math.max(1, Math.ceil(lapsToLevel.value)) }, lapsToLevel.at);
}

function ersOf(view: EngineView, car: EngineView['state']['cars'][number]): ErsState {
  const { deployLimitJ, capacityJ, attackLevelJ } = ERS_CONFIG.read(view);
  const constants = { capacityJ, deployLimitJ, attackLevelJ };
  const ers = car.energy.ers;
  if (!ers.known) {
    const hidden: Known<never> = ers;
    return {
      ...constants,
      storeJ: hidden,
      deployedThisLapJ: hidden,
      harvestedThisLapJ: hidden,
      storeTrendJPerLap: hidden,
      lapsToAttackLevel: hidden,
      attack: hidden,
      mode: hidden,
      flow: flowOf(car.energy.power),
    };
  }
  const { storeJ, deployedJ, harvestedMgukJ, harvestedMguhJ, mode } = ers.value;
  const trend = perLapRate(trendSamples(view, car.id), PER_LAP_RATE_CONFIG.read(view));
  const store = known(storeJ, ers.at);
  const lapsToAttackLevel = storeJ >= attackLevelJ ? known(0, ers.at) : lapsUntil(trend, storeJ, attackLevelJ);
  return {
    ...constants,
    storeJ: store,
    deployedThisLapJ: known(deployedJ, ers.at),
    harvestedThisLapJ: known(harvestedMgukJ + harvestedMguhJ, ers.at),
    storeTrendJPerLap: trend.known ? known(trend.value.perLap, trend.at) : trend,
    lapsToAttackLevel,
    attack: attackOf(store, attackLevelJ, lapsToAttackLevel),
    mode: known(mode, ers.at),
    flow: flowOf(car.energy.power),
  };
}

/** The ERS state of every active car: store, this lap's flows, the store's trend over the stint, the laps to the attack level and the attack readiness. */
export const ersCalculator: QuickCalculator<ErsOutput> = {
  id: ERS,
  kind: 'quick',
  reads: ['laps', 'energy'],
  cadence: { hz: 4 },
  compute: (view): ErsOutput => {
    const out: ErsOutput = {};
    for (const car of view.state.cars) if (car.active) out[car.id] = ersOf(view, car);
    return out;
  },
};
