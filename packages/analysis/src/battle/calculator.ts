// `battle` (spec 6.3): each of our cars against the car ahead and the car behind. Stateless: the gap now is from `gaps.intervals`,
// the closing rate from the line times, the pace from `pace`, the DRS status from race control's DRSE and DRSD events.
import { known, unknown, type BattleCard, type BattleSide, type CarId, type CarState, type DrsStatus, type Known, type Ms } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine';
import type { GapsOutput } from '../gaps/index.ts';
import type { Pace } from '../pace/index.ts';
import { lapsToReach, perLapRate, PER_LAP_RATE_CONFIG, type RateSample } from '../per-lap-rate/index.ts';
import { drsStatus } from '../shared/drs-status.ts';
import { ourCars } from '../shared/our-cars.ts';
import { BATTLE, BATTLE_CONFIG, type BattleOutput } from './index.ts';

const NOT_APPLICABLE = unknown('notApplicable');
type Car = DeepReadonly<CarState>;
type LineTimes = GapsOutput['lineTimes'][CarId];

/** Samples of the gap of `behind` to `ahead` at each lap's line crossing, both cars having crossed it. */
function gapSamples(behind: LineTimes | undefined, ahead: LineTimes | undefined): RateSample[] {
  const aheadAt = new Map((ahead ?? []).map((l) => [l.lap, l.at]));
  const samples: RateSample[] = [];
  for (const l of behind ?? []) {
    const other = aheadAt.get(l.lap);
    if (other !== undefined) samples.push({ lap: l.lap, value: l.at - other, at: l.at });
  }
  return samples.sort((a, b) => a.lap - b.lap);
}

const later = (a: Known<unknown> & { known: true }, b: Known<unknown> & { known: true }) => Math.max(a.at, b.at);

/** Their recent pace minus ours: positive = we are faster. */
function paceDelta(ours: Known<Ms> | undefined, theirs: Known<Ms> | undefined): Known<Ms> {
  if (ours === undefined || theirs === undefined) return unknown('notReceived');
  if (!ours.known) return ours;
  if (!theirs.known) return theirs;
  return known((theirs.value - ours.value) as Ms, later(ours, theirs));
}

function side(view: EngineView, gaps: GapsOutput, pace: Pace, drs: DrsStatus, ourId: CarId, theirId: CarId, isAhead: boolean): Known<BattleSide> {
  const { cars } = view.state;
  const ours = cars[ourId];
  const theirs = cars[theirId];
  if (ours === undefined || theirs === undefined) return NOT_APPLICABLE;
  const interval = gaps.intervals.find((i) => i.carId === ourId);
  const gapMs = (isAhead ? interval?.toAheadMs : interval?.toBehindMs) ?? unknown('notReceived');

  const { overtakeThresholdMs, drsRangeMs } = BATTLE_CONFIG.read(view);
  const samples = isAhead
    ? gapSamples(gaps.lineTimes[ourId], gaps.lineTimes[theirId])
    : gapSamples(gaps.lineTimes[theirId], gaps.lineTimes[ourId]);
  const rate = perLapRate(samples, PER_LAP_RATE_CONFIG.read(view));
  const closingMsPerLap: Known<number> = rate.known ? known(-rate.value.perLap, rate.at) : rate;
  // inside DRS range it is 0 as of the gap, with or without a closing rate; while race control has DRS off there is none to reach
  const lapsToDrs: Known<number> = !drs.enabled ? NOT_APPLICABLE : gapMs.known ? lapsToReach(rate, gapMs, drsRangeMs, 'falling') : gapMs;

  const delta = paceDelta(pace.byCar[ourId]?.recentMs, pace.byCar[theirId]?.recentMs);
  const overtakeMarginMs: Known<Ms> = delta.known ? known((delta.value - overtakeThresholdMs) as Ms, delta.at) : delta;
  const ers = theirs.energy.ers;
  const tyre = (c: Car) => ({ compound: c.tyres.visualCompound, age: c.tyres.age });
  return known(
    {
      carId: theirId,
      gapMs,
      closingMsPerLap,
      lapsToDrs,
      paceDeltaMs: delta,
      overtakeMarginMs,
      ours: tyre(ours),
      theirs: tyre(theirs),
      theirErsStoreJ: ers.known ? known(ers.value.storeJ, ers.at) : ers,
    },
    view.state.sessionTime,
  );
}

/** One of our cars against its neighbours in the order of `gaps.intervals`. */
function cardOf(view: EngineView, gaps: GapsOutput | undefined, pace: Pace | undefined, drs: DrsStatus, ourId: CarId): BattleCard {
  if (view.state.session.kind !== 'race') return { carId: ourId, ahead: NOT_APPLICABLE, behind: NOT_APPLICABLE, drs };
  if (gaps === undefined || pace === undefined) return { carId: ourId, ahead: unknown('notReceived'), behind: unknown('notReceived'), drs };
  const at = gaps.intervals.findIndex((i) => i.carId === ourId);
  const neighbour = (index: number) => (at < 0 ? undefined : gaps.intervals[index]?.carId);
  const aheadId = neighbour(at - 1);
  const behindId = neighbour(at + 1);
  return {
    carId: ourId,
    ahead: aheadId === undefined ? NOT_APPLICABLE : side(view, gaps, pace, drs, ourId, aheadId, true),
    behind: behindId === undefined ? NOT_APPLICABLE : side(view, gaps, pace, drs, ourId, behindId, false),
    drs,
  };
}

/** The player's car and the teammate's against the cars next to them, with race control's DRS status; race only. */
export const battleCalculator: QuickCalculator<BattleOutput> = {
  id: BATTLE,
  kind: 'quick',
  reads: [{ calculator: 'gaps' }, { calculator: 'pace' }, 'tyres', 'energy', 'events'],
  cadence: { hz: 2 },
  compute(view) {
    const gaps = view.outputs.get('gaps') as GapsOutput | undefined;
    const pace = view.outputs.get('pace') as Pace | undefined;
    const drs = drsStatus(view.state);
    const out: BattleOutput = {};
    for (const id of ourCars(view.state)) out[id] = cardOf(view, gaps, pace, drs, id);
    return out;
  },
};
