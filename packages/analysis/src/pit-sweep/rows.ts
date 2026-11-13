// A compound's rows of `pit-sweep` (SP4.3b spec §9.2): each stop lap's candidate outcomes on the common scenarios turned
// into its row. `inWindow` is `race-monte-carlo`'s tie rule (`paired`, `ties`) against the row with the lowest
// E[position], never a second copy (C43). Pure (C2).
import { known, unknown, type Known, type PitSweepRow, type SessionTime } from '@pitwall/domain';
import { paired, ties, type CallOutcome } from '../race-monte-carlo/index.ts';
import { placePmf } from '../shared/distribution.ts';

/** What every row of one car's table reads besides its outcomes. */
export type RowContext = {
  /** The DP's first lap (now): the stop lap whose rejoin is `rejoin`'s. */
  now: number;
  /** The car's race position at the trigger: a row's gain is a finish ahead of it. */
  position: number;
  /** The field's car count (the pmf's places). */
  cars: number;
  /** `pit-window`'s `stint.latest`: a stop after it runs past the set's life. */
  latest: Known<number>;
  /** `rejoin`'s green rejoin position (a stop now, C43). */
  greenRejoin: Known<number>;
  zTie: number;
  tieBand: number;
  /** When the values are known (the starting point's time). */
  at: SessionTime;
};

/** The lower middle value of `xs` (a median of whole places), `undefined` when empty. */
function median(xs: ArrayLike<number>): number | undefined {
  if (xs.length === 0) return undefined;
  const s = Array.from(xs).sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/** The mean of `xs` (non-empty). */
const mean = (xs: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i] ?? 0;
  return s / xs.length;
};

/** A row's simulated rejoin: the median place after the stop, unknown where it is no place (no stop in most scenarios). */
function simulatedRejoin(o: CallOutcome, at: SessionTime): Known<number> {
  const m = median(o.rejoin);
  return m === undefined || m < 1 ? unknown('insufficientData') : known(m, at);
}

/**
 * The rows of one compound: per stop lap (`stopLaps[i]`, its candidate's outcomes `outcomes[i]`) its row. A stop lap
 * whose car finishes no scenario (no finite race time) has no row: its mean race time does not exist (C3).
 */
export function rowsOf(stopLaps: readonly number[], outcomes: readonly CallOutcome[], ctx: RowContext): PitSweepRow[] {
  const kept = stopLaps.map((stopLap, i) => ({ stopLap, o: outcomes[i] as CallOutcome })).filter(({ o }) => o.finish.length > 0 && o.raceMs.some(Number.isFinite));
  const ePos = kept.map(({ o }) => mean(o.finish));
  const best = ePos.reduce((b, e, i) => (e < (ePos[b] ?? Infinity) ? i : b), 0);
  const bestFinish = kept[best] === undefined ? undefined : Float64Array.from(kept[best].o.finish);
  return kept.map(({ stopLap, o }, i): PitSweepRow => {
    let gain = 0;
    for (const p of o.finish) if (p < ctx.position) gain++;
    const traffic = median(o.traffic);
    const { latest } = ctx;
    return {
      stopLap,
      rejoinPosition: stopLap === ctx.now ? ctx.greenRejoin : simulatedRejoin(o, ctx.at),
      traffic: traffic === undefined ? unknown('insufficientData') : known(traffic, ctx.at),
      ePos: ePos[i] as number,
      positionPmf: placePmf(o.finish, ctx.cars),
      pGain: gain / o.finish.length,
      meanMs: mean(o.raceMs.filter(Number.isFinite)),
      pastLife: latest.known ? known(stopLap > latest.value, ctx.at) : latest,
      inWindow: bestFinish !== undefined && ties(paired(bestFinish, Float64Array.from(o.finish)), ctx.zTie, ctx.tieBand),
    };
  });
}
