// `scoreCalls` (SP4.3b2 Task 4, spec §9): a call's cases scored on common scenarios, no search, nothing dropped. Each
// scenario is `raceMonteCarlo`'s (`scenarios.ts`: its neutralisations, weather, the rivals' drawn stops and SC rule, our
// cars' policies played out, a committed teammate's plan); a candidate's `rival` replaces that rival's drawn stops by its
// policy in that candidate only. Draws only from the injected generator (C2, C50).
import type { CarId, ForecastResult, ForecastTrace, Policy } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { createRun, forecast, policiesIn, scenarioOf, type Run } from './scenarios.ts';
import type { CallCandidate, CallInput, CallOutcome, CallResult } from './types.ts';

type TraceEntry = ForecastTrace[number];

/** Our car's first stop from the starting lap on, before the last lap (none: -1). */
function firstStopLap(run: Run, policy: Policy | undefined): number {
  const s = policy?.stops.find((x) => x.lap >= run.start.lap && x.lap < run.start.lapsTotal);
  return s === undefined ? -1 : s.lap;
}

/** The last lap whose line a candidate's outcomes read: its first stop's rejoin and traffic laps, its rival's gap lap. */
function lastReadLap(run: Run, c: CallCandidate, stop: number, trafficLaps: number): number {
  let last = run.start.lap;
  if (stop !== -1) last = Math.max(last, stop + Math.max(1, trafficLaps));
  if (c.rival !== null) last = Math.max(last, c.rival.gapAtLap);
  return Math.min(last, run.start.lapsTotal);
}

/** Car `c`'s position in a line (0: not running there, then behind every car: `cars`). */
const placeOf = (entry: TraceEntry | undefined, c: number, cars: number): number => {
  const p = entry?.position[c] ?? 0;
  return p === 0 ? cars : p;
};

/** Distinct cars within `gapMs` of car `car` at the lines ending laps `from` … `to`. */
function trafficOf(trace: ForecastTrace, car: number, from: number, to: number, gapMs: number): number {
  const seen = new Set<number>();
  for (const e of trace) {
    if (e.lap < from || e.lap > to || (e.position[car] ?? 0) === 0) continue;
    const ours = e.gapMs[car] ?? 0;
    for (let k = 0; k < e.position.length; k++) {
      if (k === car || (e.position[k] ?? 0) === 0) continue;
      if (Math.abs((e.gapMs[k] ?? 0) - ours) <= gapMs) seen.add(k);
    }
  }
  return seen.size;
}

/** Every candidate of `input.car` on scenarios 1 … `input.scenarios` (common to every candidate); see `CallOutcome`. */
export function scoreCalls(input: CallInput, rng: Rng): CallResult {
  const { start, scenarios: n, traffic } = input;
  const car = input.car as number;
  const fixed: Record<number, Policy | null> = {};
  for (const key of Object.keys(start.sets)) fixed[Number(key)] = input.committed[Number(key) as CarId] ?? null;
  const run = createRun(start, input.hazard, input.rivalRules, fixed, rng);
  const cars = start.cars;
  const outcomes = input.candidates.map((c): CallOutcome => {
    const out: CallOutcome = {
      finish: new Int8Array(n),
      rejoin: new Int8Array(n),
      traffic: new Int8Array(n),
      gapMs: c.rival === null ? null : new Float64Array(n),
      raceMs: new Float64Array(n),
    };
    const fired = new Uint8Array(c.policy.triggers.length);
    const untilLap = c.untilLap === null ? undefined : Math.max(c.untilLap, start.lap);
    for (let i = 0; i < n; i++) {
      const id = i + 1;
      const policies = policiesIn(run, id, car, c.policy, fired);
      if (c.rival !== null) policies[c.rival.carId as number] = c.rival.policy;
      const { scenario } = scenarioOf(run, id);
      const stop = firstStopLap(run, policies[car]);
      const readTo = lastReadLap(run, c, stop, traffic.laps);
      const r: ForecastResult = forecast(run, policies, scenario, { trace: true, ...(untilLap === undefined ? {} : { toLap: untilLap }) });
      // the lines it reads past `untilLap`: the same draws, run on to them (a forecast to a lap is the full one's up to it)
      const lastLap = untilLap === undefined ? start.lapsTotal : Math.min(untilLap, start.lapsTotal);
      const trace = (readTo > lastLap ? forecast(run, policies, scenario, { trace: true, toLap: readTo }).trace : r.trace) ?? [];
      const at = (lap: number): TraceEntry | undefined => trace.find((e) => e.lap === lap);
      const p = r.position[car] ?? 0;
      out.finish[i] = p === 0 ? cars : p;
      out.raceMs[i] = p === 0 ? Number.NaN : (r.raceTimeMs[car] ?? 0);
      out.rejoin[i] = stop === -1 ? -1 : placeOf(at(stop + 1), car, cars);
      out.traffic[i] = stop === -1 ? 0 : trafficOf(trace, car, stop + 1, stop + traffic.laps, traffic.gapMs);
      if (c.rival !== null && out.gapMs !== null) {
        const e = at(Math.max(c.rival.gapAtLap, start.lap));
        const k = c.rival.carId as number;
        const running = e !== undefined && (e.position[car] ?? 0) !== 0 && (e.position[k] ?? 0) !== 0;
        out.gapMs[i] = running ? (e.gapMs[k] ?? 0) - (e.gapMs[car] ?? 0) : Number.NaN;
      }
    }
    return out;
  });
  return { outcomes };
}
