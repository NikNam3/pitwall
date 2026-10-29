import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, IncidentForUs, Known, RaceMoment } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import { columnsFor, incidentRowText, incidentRows } from './rows.ts';

const k = <T>(v: T): Known<T> => known(v, 0);
const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(2, 'Esteban Ocon'), overview(3, 'Carlos Sainz'), overview(4, 'Alexander Albon'), overview(5, 'Oscar Piastri')];

const forUs = (over: Partial<IncidentForUs> = {}): IncidentForUs => ({
  ourCarId: carId(1), positionBefore: 5, positionAfter: k(4), gapBeforeMs: k(4100), gapAfterMs: unknown('notApplicable'), ...over,
});
const entry = (over: Partial<IncidentEntry> = {}): IncidentEntry => ({
  id: 'collision:2+3:230000', at: toSessionTime(230_000), lap: 23, kind: 'collision', severity: 'major', carIds: [carId(2), carId(3)],
  timeLostMs: k(4200), forUs: [forUs()], ...over,
});
const minor = (over: Partial<IncidentEntry> = {}): IncidentEntry =>
  entry({ id: 'warning:5:210000', lap: 21, kind: 'warning', severity: 'minor', carIds: [carId(5)], timeLostMs: unknown('notApplicable'), forUs: [], ...over });
/** The incident moment whose cause names entry `entryId` (race-moment's `cause.params.entryId`). */
const incidentNaming = (entryId: string): Known<RaceMoment> =>
  k({ moment: 'incident', since: unknown('notApplicable'), cause: { rule: 'majorIncident', params: { entryId } }, active: ['incident'] });
const incident = incidentNaming('m1');

describe('incidentRows', () => {
  it('gives one row per entry, in feed order, keyed by the entry id', () => {
    const rows = incidentRows([entry(), minor()], cars, undefined);
    expect(rows.map((r) => r.id)).toEqual(['collision:2+3:230000', 'warning:5:210000']);
  });

  it('formats lap, car codes, kind and time lost as the mockup', () => {
    const [row] = incidentRows([entry()], cars, undefined);
    expect(Object.fromEntries(Object.entries(row!.cells).map(([c, cell]) => [c, cell.text]))).toMatchObject({
      lap: 'L23', cars: 'OCO SAI', what: 'collision', lost: 'lost 4.2 s',
    });
  });

  it('shows what changed for us: position mark, then the incident car\'s gap before and after, minus as U+2212', () => {
    const [collision, timeLoss] = incidentRows(
      [entry(), entry({ id: 't', kind: 'timeLoss', carIds: [carId(4)], forUs: [forUs({ positionAfter: k(5), gapBeforeMs: k(-1900), gapAfterMs: k(5800) })] })],
      cars, undefined);
    expect(collision!.cells.forUs.text).toBe('us P5→P4, OCO +4.1→DNF');
    expect(timeLoss!.cells.forUs.text).toBe('us —, ALB −1.9→+5.8');
  });

  it('takes the gap car as the first involved car that is not our car, even when ours is listed first', () => {
    const [row] = incidentRows([entry({ carIds: [carId(1), carId(4)], forUs: [forUs({ gapBeforeMs: k(-1900), gapAfterMs: k(5800) })] })], cars, undefined);
    expect(row!.cells.forUs.text).toBe('us P5→P4, ALB −1.9→+5.8');
    expect(row!.cells.cars.text).toBe('KUH ALB');
  });

  it('writes a position change as P7→P9 through the position mark', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: 7, positionAfter: k(9) })] })], cars, undefined);
    expect(row!.cells.forUs.text.startsWith('us P7→P9')).toBe(true);
  });

  it('writes P7→ while the position after is unknown', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: 7, positionAfter: unknown('insufficientData') })] })], cars, undefined);
    expect(row!.cells.forUs.text.startsWith('us P7→,')).toBe(true);
  });

  it('leaves the gap part out when both gaps are unknown, and the cell empty without forUs', () => {
    const [a, b] = incidentRows(
      [entry({ forUs: [forUs({ gapBeforeMs: unknown('insufficientData'), gapAfterMs: unknown('insufficientData') })] }), minor()],
      cars, undefined);
    expect(a!.cells.forUs.text).toBe('us P5→P4');
    expect(b!.cells.forUs.text).toBe('');
  });

  it('renders an unresolved time loss as an empty cell with its reason on hover', () => {
    const [row] = incidentRows([entry({ timeLostMs: unknown('insufficientData') })], cars, undefined);
    expect(row!.cells.lost).toMatchObject({ text: '', reason: 'insufficientData' });
    expect(row!.cells.what.text).toBe('collision');
  });

  it('renders warnings and penalties (time lost not applicable) as an empty lost cell', () => {
    const [row] = incidentRows([minor()], cars, undefined);
    expect(row!.cells.lost.text).toBe('');
  });

  it('leaves out a car missing from cars.overview, with the reason on hover, and an empty cars cell for no car', () => {
    const [a, b] = incidentRows([entry({ carIds: [carId(2), carId(9)] }), minor({ carIds: [] })], cars, undefined);
    expect(a!.cells.cars).toEqual({ text: 'OCO', reason: 'notReceived' });
    expect(b!.cells.cars).toEqual({ text: '' });
  });

  it('dims minor entries and ambers only the entry the incident moment names', () => {
    const rows = incidentRows([minor({ id: 'w' }), entry({ id: 'm1' }), entry({ id: 'm2' })], cars, incident);
    expect(rows.map((r) => r.role)).toEqual(['textDim', 'warning', undefined]);
    const older = incidentRows([entry({ id: 'm1' }), entry({ id: 'm2' })], cars, incidentNaming('m2'));
    expect(older.map((r) => r.role)).toEqual([undefined, 'warning']);
  });

  it('ambers nothing outside the incident moment', () => {
    const rows = incidentRows([entry({ id: 'm1' }), minor()], cars, undefined);
    expect(rows.map((r) => r.role)).toEqual([undefined, 'textDim']);
  });
});

describe('text layout', () => {
  it('compact shows lap, cars and what only', () => {
    expect(columnsFor('compact')).toEqual(['lap', 'cars', 'what']);
    expect(columnsFor('full')).toEqual(['lap', 'cars', 'what', 'lost', 'forUs']);
    const [row] = incidentRows([entry()], cars, undefined);
    expect(incidentRowText('compact', row!)).toBe(' L23  OCO SAI  collision');
  });

  it('full rows put the fields on a fixed grid, as the mockup', () => {
    const [a, b, c] = incidentRows(
      [entry(), entry({ id: 'd', lap: 14, kind: 'damage', carIds: [carId(1)], timeLostMs: unknown('insufficientData'), forUs: [] }), minor()],
      cars, undefined);
    expect(incidentRowText('full', a!)).toBe(' L23  OCO SAI  collision           lost 4.2 s  us P5→P4, OCO +4.1→DNF');
    expect(incidentRowText('full', b!).trimEnd()).toBe(' L14  KUH      damage');
    expect(incidentRowText('full', c!).trimEnd()).toBe(' L21  PIA      warning');
  });
});
