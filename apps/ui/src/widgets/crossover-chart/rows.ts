// The crossover chart's lines and numbers (SP4.1b spec 4; C65): the topic's values mapped and formatted, nothing
// computed. The medians, the reference lines, the first faster car and the payback are the analysis's (C43).
import type { CarOverview } from '@pitwall/contracts';
import type { Crossover, EstimateSource, Known, Ms, TyreType } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import type { ChartSeries } from '../../kit/chart/data.ts';
import { knownPart, unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import { sectorNames } from '../../kit/text.ts';
import { formatLapNumber, formatLapTime, formatLaps, formatPercentTenths } from '../../kit/values/format.ts';
import { role, type Role } from '../../theme/index.ts';
import { referenceRole, typeRole } from './emphasis.ts';
import * as text from './text.ts';

/** The order of the type lines. */
const TYPES = ['slick', 'inter', 'wet'] as const satisfies readonly TyreType[];

const colour = (r: Role, dashed: boolean): NonNullable<ChartSeries['colour']> => ({ colour: role(r), dashed, ownCar: false });

/** A flat line at the value from the first to the last lap number of `byLap`; none without a lap or a known value. */
function referenceLine(byLap: Crossover['byLap'], value: Known<Ms>, label: string, r: Role): ChartSeries[] {
  const first = byLap[0];
  const last = byLap[byLap.length - 1];
  if (!value.known || first === undefined || last === undefined) return [];
  return [{ label, points: [[first.lapNumber, value.value], [last.lapNumber, value.value]], colour: colour(r, true) }];
}

/** One line per type with a known median (slick, inter, wet), then the 110 % line and the dry reference. */
export function chartSeries(c: Crossover): ChartSeries[] {
  const types = TYPES.flatMap((type): ChartSeries[] => {
    const points = c.byLap.flatMap((l): Array<[number, number]> => {
      const m = l.medianMs[type];
      return m.known ? [[l.lapNumber, m.value]] : [];
    });
    return points.length === 0 ? [] : [{ label: text.typeNames[type], points, colour: colour(typeRole(type), false) }];
  });
  return [
    ...types,
    ...referenceLine(c.byLap, c.line110Ms, text.line110Label, referenceRole.line110),
    ...referenceLine(c.byLap, c.dryRefMs, text.dryRefLabel, referenceRole.dryRef),
  ];
}

/** The first faster car's parts: its code, its type, its sector and its lap. */
export type FirstFasterCells = { code: CellPart; type: TyreType; sector: string; lap: string };

export type CrossoverNumbers = {
  us: CellPart;
  dryRef: CellPart;
  firstFaster: FirstFasterCells | CellPart;
  payback: CellPart;
  /** The pit loss's source for the kit badge; none while the payback is unknown. */
  paybackSource: EstimateSource | undefined;
};

/** The three numbers, formatted: US with the dry reference, the first faster car, the payback with its loss source. */
export function crossoverNumbers(c: Crossover, cars: readonly CarOverview[]): CrossoverNumbers {
  const ff = c.firstFaster;
  return {
    us: knownPart(c.ourPct, formatPercentTenths),
    dryRef: knownPart(c.dryRefMs, formatLapTime),
    firstFaster: ff.known
      ? {
          code: carCodeById(cars, ff.value.carId),
          type: ff.value.type,
          sector: sectorNames[ff.value.sector],
          lap: formatLapNumber(ff.value.lapNumber),
        }
      : unknownPart(ff.reason),
    payback: knownPart(c.payback, (p) => formatLaps(p.laps)),
    paybackSource: c.payback.known ? c.payback.value.lossSource : undefined,
  };
}

/** True for a known first faster car's parts. */
export const isFirstFaster = (ff: FirstFasterCells | CellPart): ff is FirstFasterCells => 'type' in ff;
