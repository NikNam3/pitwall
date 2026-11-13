// The select of `pitSweep.car` (SP4.3b spec §9.2): the job's output per car to the table of the panel's compound. `auto`
// resolves to the compound `pit-sweep` named (C43), never in the panel or the display.
import type { PitSweepOutput } from '@pitwall/analysis';
import { NOISE_COMPOUNDS, unknown, type CarId, type NoiseCompound, type PitSweep } from '@pitwall/domain';

const COMPOUNDS: ReadonlySet<string> = new Set(NOISE_COMPOUNDS);

/** The car and compound of client params, or `undefined` when either is missing or not one of the topic's. */
function paramsOf(params: object): { carId: CarId; compound: NoiseCompound | 'auto' } | undefined {
  const p = params as Record<string, unknown>;
  const carId = Object.hasOwn(p, 'carId') ? p['carId'] : undefined;
  const compound = Object.hasOwn(p, 'compound') ? p['compound'] : undefined;
  if (typeof carId !== 'number' || !Number.isInteger(carId) || carId < 0) return undefined;
  if (typeof compound !== 'string' || (compound !== 'auto' && !COMPOUNDS.has(compound))) return undefined;
  return { carId: carId as CarId, compound: compound as NoiseCompound | 'auto' };
}

/**
 * No entry for `params.carId` → no data; `compound: 'auto'` → the table of the compound `auto` resolves to (or `auto`'s
 * reason); a compound → its table, or `unknown('notApplicable')` without one. `params` is client input.
 */
export function selectSweep(out: PitSweepOutput, params: object): PitSweep | undefined {
  const p = paramsOf(params);
  if (p === undefined || !Object.hasOwn(out, p.carId)) return undefined;
  const car = out[p.carId];
  if (car === undefined) return undefined;
  const head = { carId: car.carId, lap: car.lap, position: car.position };
  const fromAuto = p.compound === 'auto';
  if (p.compound !== 'auto') return { ...head, compound: p.compound, fromAuto, table: car.byCompound[p.compound] ?? unknown('notApplicable') };
  if (!car.auto.known) return { ...head, compound: 'auto', fromAuto, table: car.auto };
  return { ...head, compound: car.auto.value, fromAuto, table: car.byCompound[car.auto.value] ?? unknown('notApplicable') };
}
