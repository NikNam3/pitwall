import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import type { CarId, LapBoard, LapBoardRow, Known, Ms, SectorStatus } from '@pitwall/domain';
import { carCodeById, type CarCodeCell } from '../../kit/car/car-label.ts';
import { ourCars } from '../../kit/car/our-cars.ts';

export type LapAnalysisInput = { board: LapBoard; cars: CarOverview[]; session: SessionInfo };

/** One time cell: the value as the board gave it, whether it is an absolute time, and its best status. */
export type Cell = { value: Known<Ms>; absolute: boolean; status: SectorStatus };

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

function status(value: Known<Ms>, holder: LapBoard['sessionBest']['lap'], id: CarId): SectorStatus {
  if (!value.known) return 'none';
  if (holder.known && holder.value.carId === id && holder.value.ms === value.value) return 'sessionBest';
  return 'personalBest';
}

function toRow(row: LapBoardRow, input: LapAnalysisInput, ours: ReadonlySet<CarId>): LapAnalysisRow {
  const { board, cars } = input;
  const reference = row.carId === board.referenceCarId;
  const pick = <T,>(absolute: T, delta: T): T => (reference ? absolute : delta);
  const make = (absolute: Known<Ms>, delta: Known<Ms>, holder: LapBoard['sessionBest']['lap'] | undefined): Cell => {
    const value = pick(absolute, delta);
    return { value, absolute: reference, status: holder ? status(value.known ? absolute : value, holder, row.carId) : 'none' };
  };
  const d = row.deltaToReference;
  const sb = board.sessionBest;
  return {
    carId: row.carId,
    code: carCodeById(cars, row.carId),
    ours: ours.has(row.carId),
    reference,
    best: make(row.bestLapMs, d.bestLapMs, sb.lap),
    sectors: row.bestSectorsMs.map((v, i) => make(v, d.bestSectorsMs[i] ?? v, sb.sectors[i])) as LapAnalysisRow['sectors'],
    theo: make(row.theoreticalBestMs, d.theoreticalBestMs, undefined),
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
  return sorted.map((r) => toRow(r, input, ours));
}
