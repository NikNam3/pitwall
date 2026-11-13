// `fieldPositions` (SP4.3b spec §8.4): every car's position pmf at given laps under fixed plans, over a fixed count
// of scenarios drawn as `raceMonteCarlo` draws them (neutralisations, the rivals' stops and SC rule), no search; for
// `forecast-score`'s CRPS. A car that has not completed a requested lap (retired) takes the places behind those that did.
import type { CarId, Policy } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { createRun, forecast, policiesIn, scenarioOf } from './scenarios.ts';
import type { FieldInput, FieldResult } from './types.ts';

export function fieldPositions(input: FieldInput, rng: Rng): FieldResult {
  const { start, laps } = input;
  const fixed: Record<number, Policy | null> = {};
  for (const key of Object.keys(start.sets)) fixed[Number(key)] = input.plans[Number(key) as CarId] ?? null;
  const run = createRun(start, input.hazard, input.rivalRules, fixed, rng);
  const n = start.cars;
  const counts = Array.from({ length: n }, () => laps.map(() => new Array<number>(n).fill(0)));
  const toLap = Math.min(Math.max(start.lap, ...laps), start.lapsTotal);
  const none = new Uint8Array(0);
  const position = new Int8Array(n);
  for (let id = 1; id <= input.scenarios; id++) {
    const r = forecast(run, policiesIn(run, id, -1, null, none), scenarioOf(run, id).scenario, { trace: true, toLap });
    laps.forEach((lap, j) => {
      const at = Math.min(Math.max(lap, start.lap), toLap);
      const entry = r.trace?.find((t) => t.lap === at);
      let next = 0;
      for (let c = 0; c < n; c++) {
        position[c] = entry?.position[c] ?? 0;
        if ((position[c] ?? 0) > next) next = position[c] ?? 0;
      }
      for (let c = 0; c < n; c++) {
        const p = (position[c] ?? 0) === 0 ? ++next : (position[c] ?? 0);
        const row = counts[c]?.[j];
        if (row !== undefined) row[p - 1] = (row[p - 1] ?? 0) + 1;
      }
    });
  }
  const positionPmf: Record<CarId, number[][]> = {};
  for (let c = 0; c < n; c++) positionPmf[c as CarId] = (counts[c] ?? []).map((row) => row.map((k) => k / input.scenarios));
  return { positionPmf };
}
