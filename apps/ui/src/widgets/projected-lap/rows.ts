// Pure join of the projection into the three display rows: texts, roles and hidden reasons.
import type { Known, Projection, UnknownReason } from '@pitwall/domain';
import { gridRow } from '../../kit/grid/grid.ts';
import type { GridColumn } from '../../kit/grid/grid.ts';
import { formatDeltaMs, formatLapTime, formatPosition, formatSeconds } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { cutOffRole, deltaRole, finishRole } from './emphasis.ts';
import { columnHeaders, labels, names, outLap, seconds } from './text.ts';

export type ProjectionRow = {
  key: 'proj' | 'cutOff' | 'finish';
  name: string;
  time: string;
  pos: string;
  delta: string;
  label: string;
  deltaRole: Role | undefined;
  /** Why a value of this row is hidden (first one), for the hover. */
  reason?: UnknownReason;
};

/** Columns: name, time, position, delta, label. */
export const PROJECTION_COLUMNS = [
  { key: 'name', width: 7, align: 'left' },
  { key: 'time', width: 8, align: 'right' },
  { key: 'pos', width: 3, align: 'right' },
  { key: 'delta', width: 7, align: 'right' },
  { key: 'label', width: 12, align: 'left' },
] as const satisfies readonly (GridColumn & { key: string })[];

/** The column header line over the same fixed fields as the rows; compact has no label column. */
export const projectionHeader = (full = true): string => {
  const columns = full ? PROJECTION_COLUMNS : PROJECTION_COLUMNS.slice(0, -1);
  return gridRow(columns, columnHeaders.slice(0, columns.length));
};

const text = <T>(value: Known<T>, format: (v: T) => string): string => (value.known ? format(value.value) : '');
const firstReason = (...values: Known<unknown>[]): UnknownReason | undefined => {
  for (const v of values) if (!v.known) return v.reason;
  return undefined;
};
const withReason = (row: Omit<ProjectionRow, 'reason'>, reason: UnknownReason | undefined): ProjectionRow =>
  reason === undefined ? row : { ...row, reason };

/** The rows PROJ, CUT-OFF and FINISH for a projection; hidden values are empty cells. `ours`: the car is one of ours. */
export function projectionRows(p: Projection, ours: boolean): ProjectionRow[] {
  const proj: ProjectionRow = p.onLap
    ? withReason({
        key: 'proj', name: names.proj,
        time: text(p.projectedLapMs, formatLapTime),
        pos: text(p.projectedPosition, formatPosition),
        delta: text(p.deltaToBestMs, formatDeltaMs),
        label: p.deltaToBestMs.known ? labels.toBest : '',
        deltaRole: p.deltaToBestMs.known ? deltaRole(p.deltaToBestMs.value, ours) : undefined,
      }, firstReason(p.projectedLapMs, p.projectedPosition, p.deltaToBestMs))
    : { key: 'proj', name: names.proj, time: outLap, pos: '', delta: '', label: '', deltaRole: undefined };

  const cut = p.cutOff;
  const margin: Known<number> = cut.known ? cut.value.marginMs : cut;
  const cutOff = withReason({
    key: 'cutOff', name: names.cutOff,
    time: text(cut, (c) => formatLapTime(c.timeMs)),
    pos: text(cut, (c) => formatPosition(c.position)),
    delta: text(margin, formatDeltaMs),
    label: margin.known ? labels.margin : '',
    deltaRole: margin.known ? cutOffRole(margin.value) : undefined,
  }, firstReason(cut, margin));

  const fin = p.finishMarginMs;
  const finish = withReason({
    key: 'finish', name: names.finish, time: '', pos: '',
    delta: text(fin, (ms) => `${formatSeconds(ms, 1)}${seconds}`),
    label: fin.known ? labels.leftAtLine : '',
    deltaRole: fin.known ? finishRole(fin.value) : undefined,
  }, firstReason(fin));

  return [proj, cutOff, finish];
}
