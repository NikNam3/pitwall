import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import type { BestStatus, CarId, LapBoard, LapBoardRow, Known, Ms } from '@pitwall/domain';
import { carCodeById, type CarCodeCell } from '../../kit/car/car-label.ts';
import { ourCars } from '../../kit/car/our-cars.ts';
import type { Cell, LapColumnKey } from './columns.ts';

export type { Cell } from './columns.ts';

export type LapAnalysisInput = { board: LapBoard; cars: CarOverview[]; session: SessionInfo };

export type LapAnalysisRow = {
  carId: CarId;
  /** The car code; empty with the reason when the field lacks the car. */
  code: CarCodeCell;
  ours: boolean;
  reference: boolean;
  best: Cell;
  sectors: [Cell, Cell, Cell];
  theo: Cell;
};

function toRow(row: LapBoardRow, referenceCarId: CarId, cars: readonly CarOverview[], ours: ReadonlySet<CarId>): LapAnalysisRow {
  const reference = row.carId === referenceCarId;
  // the reference row shows its absolute times, every other row its deltas to the reference
  const cell = (absolute: Known<Ms>, delta: Known<Ms>, status: BestStatus): Cell => ({ value: reference ? absolute : delta, absolute: reference, status });
  const d = row.deltaToReference;
  const sector = (i: 0 | 1 | 2): Cell => cell(row.bestSectorsMs[i], d.bestSectorsMs[i], row.bestSectorStatus[i]);
  return {
    carId: row.carId,
    code: carCodeById(cars, row.carId),
    ours: ours.has(row.carId),
    reference,
    best: cell(row.bestLapMs, d.bestLapMs, row.bestLapStatus),
    sectors: [sector(0), sector(1), sector(2)],
    // the theoretical best is nobody's lap: it is never a session best
    theo: cell(row.theoreticalBestMs, d.theoreticalBestMs, 'none'),
  };
}

const rank = (r: LapBoardRow): number => (r.bestLapMs.known ? r.bestLapMs.value : Infinity);

/** The table rows: the reference car first (absolute times), then the others by best lap, fastest first. */
export function buildRows(input: LapAnalysisInput): LapAnalysisRow[] {
  const { rows, referenceCarId } = input.board;
  const sorted = [...rows].sort((a, b) => {
    if (a.carId === referenceCarId) return -1;
    if (b.carId === referenceCarId) return 1;
    const ra = rank(a);
    const rb = rank(b);
    if (ra === rb) return a.carId - b.carId;
    return ra - rb;
  });
  const ours = ourCars(input.session);
  return sorted.map((r) => toRow(r, referenceCarId, input.cars, ours));
}

/** The time cell of a column; the DRV column has none. */
export function cellOf(row: LapAnalysisRow, key: LapColumnKey): Cell | undefined {
  switch (key) {
    case 'best':
      return row.best;
    case 'theo':
      return row.theo;
    case 's1':
      return row.sectors[0];
    case 's2':
      return row.sectors[1];
    case 's3':
      return row.sectors[2];
    case 'drv':
      return undefined;
  }
}
