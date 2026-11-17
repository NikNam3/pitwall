// The grid start in a scenario (SP4.3d spec §7.2; C2, C50; research 13, common random numbers). On a starting point
// with `start` set, before lap 1:
// - a rival with `start.odds` draws one option (its compound and its stop window) from its own stream of the
//   scenario's draws (`MC_PURPOSE.startOption`), so every candidate of a run sees the same draw;
// - a car with `start.freeCompound` takes its policy's `startCompound`.
// A car whose policy carries a `startCompound` is fitted on a new set of it (age 0, wear 0, a new set's laps to the
// limit; our car's set taken from its sets) on the scenario's copy of the starting point that `race-forecast` plays.
// `start: null` (a start inside the race) fits nothing and draws nothing.
import { NOISE_COMPOUNDS, tyreIndex, type NoiseCompound, type Policy, type StartingPoint, type StartOption } from '@pitwall/domain';
import { streamKey, uniform, type Draws } from '../race-forecast/draws.ts';
import { MC_PURPOSE } from './constants.ts';

/** Whether car slot `k` takes its policy's `startCompound` (the grid start's free compound). */
export const freeAtStart = (start: StartingPoint, k: number): boolean => start.start?.freeCompound[k] === 1;

/** The option the uniform `u` falls in by the options' chances; the last one when they sum below `u`. */
function optionAt(options: readonly StartOption[], u: number): StartOption | null {
  let s = 0;
  let last: StartOption | null = null;
  for (const o of options) {
    if (!(o.p > 0)) continue;
    last = o;
    s += o.p;
    if (u < s) return o;
  }
  return last;
}

/** A copy of `start` whose per-car tyre state (and stop windows) a fit may change; the rest shared. */
function copied(start: StartingPoint): StartingPoint {
  return {
    ...start,
    compound: start.compound.slice(),
    tyreAge: start.tyreAge.slice(),
    wearPct: start.wearPct.slice(),
    fittedLapsToLimit: start.fittedLapsToLimit.slice(),
    stopLow: start.stopLow.slice(),
    stopMid: start.stopMid.slice(),
    stopHigh: start.stopHigh.slice(),
    sets: { ...start.sets },
  };
}

/** Car slot `k` of the copy `s` on a new set of `compound`: our car's taken from its sets (its first new one of it). */
function fitOn(s: StartingPoint, k: number, compound: NoiseCompound): void {
  const ci = NOISE_COMPOUNDS.indexOf(compound);
  s.compound[k] = ci;
  s.tyreAge[k] = 0;
  s.wearPct[k] = 0;
  s.fittedLapsToLimit[k] = s.tyre.lapsToLimit[tyreIndex(k, ci)] ?? -1;
  const sets = s.sets[k as keyof typeof s.sets];
  if (sets === undefined) return;
  const at = sets.findIndex((x) => x.compound === compound && x.wearPct <= 0);
  if (at >= 0) s.sets[k as keyof typeof s.sets] = [...sets.slice(0, at), ...sets.slice(at + 1)];
}

/**
 * The rivals' drawn starts of one scenario (`draws`: its streams): the scenario's starting point with each drawn rival
 * on a new set of its option's compound and with its option's stop window, and per car slot the drawn compound (`null`:
 * none drawn). Without odds, `start` itself.
 */
export function drawStarts(start: StartingPoint, ours: ReadonlySet<number>, draws: Draws): { start: StartingPoint; drawn: (NoiseCompound | null)[] } {
  const drawn: (NoiseCompound | null)[] = Array.from({ length: start.cars }, () => null);
  const odds = start.start?.odds;
  if (odds === undefined) return { start, drawn };
  let out: StartingPoint | null = null;
  for (let k = 0; k < start.cars; k++) {
    const options = odds[k];
    if (options === null || options === undefined || ours.has(k) || freeAtStart(start, k) || start.retired[k] === 1) continue;
    const option = optionAt(options, uniform(streamKey(draws, k, 0), MC_PURPOSE.startOption, 0));
    if (option === null) continue;
    out ??= copied(start);
    fitOn(out, k, option.compound);
    out.stopLow[k] = option.stopLow;
    out.stopMid[k] = option.stopMid;
    out.stopHigh[k] = option.stopHigh;
    drawn[k] = option.compound;
  }
  return { start: out ?? start, drawn };
}

/**
 * The starting point `race-forecast` plays `policies` from: `start` with every car whose policy carries a
 * `startCompound` on a new set of it; `start` itself inside the race or where no policy carries one.
 */
export function fittedStart(start: StartingPoint, policies: readonly Policy[]): StartingPoint {
  if (start.start === null) return start;
  let out: StartingPoint | null = null;
  policies.forEach((p, k) => {
    if (p.startCompound === undefined) return;
    out ??= copied(start);
    fitOn(out, k, p.startCompound);
  });
  return out ?? start;
}
