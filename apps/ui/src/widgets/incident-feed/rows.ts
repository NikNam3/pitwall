// Join and format logic of the incident feed: one pure function from the topics to display rows.
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, IncidentEntry, IncidentForUs, Known, RaceMoment, UnknownReason } from '@pitwall/domain';
import { carCode } from '../../kit/car/car-code.ts';
import { gridRow } from '../../kit/grid/grid.ts';
import type { GridColumn } from '../../kit/grid/grid.ts';
import { incidentKinds, insightText, separator } from '../../kit/text.ts';
import { fixed, formatLapNumber } from '../../kit/values/format.ts';
import { positionMarkText } from '../../kit/values/position-mark.ts';
import type { Role } from '../../theme/roles.ts';
import { incidentRole } from './emphasis.ts';
import * as text from './text.ts';

export type IncidentColumn = 'lap' | 'cars' | 'what' | 'lost' | 'forUs';
export type IncidentCell = { text: string; reason?: UnknownReason };
export type IncidentRow = { id: string; role?: Role | undefined; cells: Record<IncidentColumn, IncidentCell> };

/** Id of the first major entry of the newest-first feed. */
export const newestMajorId = (feed: readonly IncidentEntry[]): string | undefined => feed.find((e) => e.severity === 'major')?.id;

const signedSeconds = (ms: number): string => (ms < 0 ? `${insightText.minus}${fixed(-ms / 1000, 1)}` : `+${fixed(ms / 1000, 1)}`);

function gapText(before: Known<number>, after: Known<number>): string {
  if (!before.known && !after.known) return '';
  const b = before.known ? signedSeconds(before.value) : '';
  if (after.known) return `${b}→${signedSeconds(after.value)}`;
  return `${b}→${after.reason === 'notApplicable' ? text.retired : ''}`;
}

function forUsText(f: IncidentForUs, entry: IncidentEntry, codeOf: (id: CarId) => string): string {
  const position = f.positionAfter.known && f.positionAfter.value === f.positionBefore ? text.unchanged : positionMarkText({ from: f.positionBefore, to: f.positionAfter });
  const other = entry.carIds.find((id) => id !== f.ourCarId);
  const gap = other === undefined ? '' : gapText(f.gapBeforeMs, f.gapAfterMs);
  return `${text.us} ${position}${gap === '' || other === undefined ? '' : `, ${codeOf(other)} ${gap}`}`;
}

/** One row per entry, in feed order. */
export function incidentRows(feed: readonly IncidentEntry[], cars: readonly CarOverview[], moment: Known<RaceMoment> | undefined): IncidentRow[] {
  const codeOf = (id: CarId): string => {
    const car = cars.find((c) => c.id === id);
    return car === undefined ? `#${id}` : carCode(car.identity);
  };
  const newest = newestMajorId(feed);
  return feed.map((entry) => {
    const lost: IncidentCell = entry.timeLostMs.known ? { text: text.lost(entry.timeLostMs.value) } : { text: '', reason: entry.timeLostMs.reason };
    return {
      id: entry.id,
      role: incidentRole(moment, entry, newest),
      cells: {
        lap: { text: formatLapNumber(entry.lap) },
        cars: { text: entry.carIds.map(codeOf).join(' ') },
        what: { text: incidentKinds[entry.kind] },
        lost,
        forUs: { text: entry.forUs.map((f) => forUsText(f, entry, codeOf)).join(separator) },
      },
    };
  });
}

/** The columns a size mode shows. */
export const columnsFor = (mode: string): IncidentColumn[] => (mode === 'full' ? ['lap', 'cars', 'what', 'lost', 'forUs'] : ['lap', 'cars', 'what']);

/** Character widths of the grid; the last column is free. */
export const widths: Record<IncidentColumn, number> = { lap: 3, cars: 7, what: 18, lost: 10, forUs: 0 };

/** A row as one line of text on the fixed grid. */
export function incidentRowText(mode: string, row: IncidentRow): string {
  const columns = columnsFor(mode);
  const grid: GridColumn[] = columns.map((c) => ({ width: c === 'forUs' ? row.cells.forUs.text.length : widths[c], align: 'left' }));
  return ` ${gridRow(grid, columns.map((c) => row.cells[c].text), 2)}`.trimEnd();
}
