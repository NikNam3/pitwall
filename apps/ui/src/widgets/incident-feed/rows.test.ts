import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, IncidentForUs, Known, RaceMoment } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import { columnsFor, fitRow, incidentRowText, incidentRows } from './rows.ts';

const k = <T>(v: T): Known<T> => known(v, 0);
const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(2, 'Esteban Ocon'), overview(3, 'Carlos Sainz'), overview(4, 'Alexander Albon'), overview(5, 'Oscar Piastri')];

const forUs = (over: Partial<IncidentForUs> = {}): IncidentForUs => ({
  ourCarId: carId(1), otherCarId: k(carId(2)), positionBefore: k(5), positionAfter: k(4), gapBeforeMs: k(4100), gapAfterMs: unknown('notApplicable'), ...over,
});
const entry = (over: Partial<IncidentEntry> = {}): IncidentEntry => ({
  id: 'collision:2+3:230000', at: toSessionTime(230_000), lap: 23, kind: 'collision', severity: 'major', carIds: [carId(2), carId(3)],
  timeLostMs: k(4200), forUs: [forUs()], where: { sector: unknown('notReceived') }, ...over,
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
      [entry(), entry({ id: 't', kind: 'timeLoss', carIds: [carId(4)], forUs: [forUs({ otherCarId: k(carId(4)), positionAfter: k(5), gapBeforeMs: k(-1900), gapAfterMs: k(5800) })] })],
      cars, undefined);
    expect(collision!.cells.forUs.text).toBe('us P5→P4, OCO +4.1→DNF');
    expect(timeLoss!.cells.forUs.text).toBe('us —, ALB −1.9→+5.8');
  });

  it('names the car the analysis measured the gaps to (otherCarId), not one it picks from the entry itself', () => {
    const [row] = incidentRows([entry({ carIds: [carId(1), carId(4)], forUs: [forUs({ otherCarId: k(carId(4)), gapBeforeMs: k(-1900), gapAfterMs: k(5800) })] })], cars, undefined);
    expect(row!.cells.forUs.text).toBe('us P5→P4, ALB −1.9→+5.8');
    expect(row!.cells.cars.text).toBe('KUH ALB');
    const [second] = incidentRows([entry({ forUs: [forUs({ otherCarId: k(carId(3)) })] })], cars, undefined);
    expect(second!.cells.forUs.text).toBe('us P5→P4, SAI +4.1→DNF');
  });

  it('shows no gap part when the entry has no other car (otherCarId notApplicable)', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ otherCarId: unknown('notApplicable'), gapBeforeMs: unknown('notApplicable') })] })], cars, undefined);
    expect(row!.cells.forUs).toMatchObject({ text: 'us P5→P4' });
    expect(row!.cells.forUs.reason).toBeUndefined();
  });

  it('leaves an unknown position out of the plain text, with its reason on hover (no invented position)', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: unknown('notReceived') })] })], cars, undefined);
    expect(row!.cells.forUs).toMatchObject({ text: 'us, OCO +4.1→DNF', reason: 'notReceived' });
  });


  it('gives an unknown gap after its reason on hover; DNF (not applicable) needs none', () => {
    const [waiting] = incidentRows([entry({ forUs: [forUs({ gapAfterMs: unknown('notReceived') })] })], cars, undefined);
    expect(waiting!.cells.forUs).toMatchObject({ text: 'us P5→P4, OCO +4.1→', reason: 'notReceived' });
    const [retired] = incidentRows([entry()], cars, undefined);
    expect(retired!.cells.forUs.reason).toBeUndefined();
  });

  it('writes a position change as P7→P9 through the position mark', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: k(7), positionAfter: k(9) })] })], cars, undefined);
    expect(row!.cells.forUs.text.startsWith('us P7→P9')).toBe(true);
  });

  it('writes P7→ while the position after is unknown', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: k(7), positionAfter: unknown('insufficientData') })] })], cars, undefined);
    expect(row!.cells.forUs.text.startsWith('us P7→,')).toBe(true);
  });

  it('keeps the other car and the arrow when both gaps are unknown, each mark in its place; the cell is empty without forUs', () => {
    const [a, b] = incidentRows(
      [entry({ forUs: [forUs({ gapBeforeMs: unknown('insufficientData'), gapAfterMs: unknown('insufficientData') })] }), minor()],
      cars, undefined);
    expect(a!.cells.forUs).toMatchObject({ text: 'us P5→P4, OCO →', reason: 'insufficientData' });
    expect(a!.cells.forUs.parts?.filter((p) => p.reason !== undefined).map((p) => p.reason)).toEqual(['insufficientData', 'insufficientData']);
    expect(b!.cells.forUs.text).toBe('');
  });

  // One builder of the for-us cell (review 2, F7): the parts are built once, the plain text comes from their texts and
  // the hover reason is the first unknown part's, so the text and the marks never disagree. The plain text has no stray
  // space (review 3, U1): an unknown part's empty text takes the space it leaves before a comma or beside another space
  // with it; the parts keep every space, as the marks stand in their places.
  describe('the for-us cell is built from its parts', () => {
    const cases: Record<string, { list: IncidentForUs[]; text: string }> = {
      'position before unknown': { list: [forUs({ positionBefore: unknown('notReceived') })], text: 'us, OCO +4.1→DNF' },
      'position after unknown': { list: [forUs({ positionAfter: unknown('insufficientData') })], text: 'us P5→, OCO +4.1→DNF' },
      'gap after not received': { list: [forUs({ gapAfterMs: unknown('notReceived') })], text: 'us P5→P4, OCO +4.1→' },
      'both gaps unknown': { list: [forUs({ gapBeforeMs: unknown('insufficientData'), gapAfterMs: unknown('realism') })], text: 'us P5→P4, OCO →' },
      'other car missing from the field, gap after unknown': {
        list: [forUs({ otherCarId: k(carId(9)), gapAfterMs: unknown('notReceived') })], text: 'us P5→P4, +4.1→',
      },
      'no other car': { list: [forUs({ otherCarId: unknown('notApplicable'), positionAfter: unknown('notReceived') })], text: 'us P5→' },
      // the joined form: our two cars one after the other, each in its plain form
      'player and teammate, the second unknown': {
        list: [forUs(), forUs({ ourCarId: carId(5), positionBefore: unknown('realism') })], text: 'us P5→P4, OCO +4.1→DNF · us, OCO +4.1→DNF',
      },
    };

    it.each(Object.entries(cases))('%s: the plain text without stray spaces, the reason the first unknown part\'s', (_name, { list, text }) => {
      const [row] = incidentRows([entry({ forUs: list })], cars, undefined);
      const cell = row!.cells.forUs;
      expect(cell.parts, 'an unknown value has its part').toBeDefined();
      expect(cell.text).toBe(text);
      expect(cell.reason).toBe(cell.parts!.find((p) => p.reason !== undefined)?.reason);
    });

    it.each(Object.entries(cases))('%s: the parts hold the plain text, with its spaces and a mark at each unknown value', (_name, { list, text }) => {
      const [row] = incidentRows([entry({ forUs: list })], cars, undefined);
      const parts = row!.cells.forUs.parts!;
      const known = parts.filter((p) => p.reason === undefined).map((p) => p.text).join('');
      expect(known.replace(/ +(?=,)/g, '').replace(/ {2,}/g, ' ')).toBe(text);
      expect(parts.filter((p) => p.reason !== undefined).every((p) => p.text === '')).toBe(true);
    });
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

describe('the incident detail in the what cell (mockup: time loss (T7), damage FL wing +12, warning 2/3)', () => {
  const what = (over: Partial<IncidentEntry>): string => incidentRows([entry(over)], cars, undefined)[0]!.cells.what.text;

  it('a collision and a time loss name the sector (F1 25 has no turn numbers)', () => {
    expect(what({ where: { sector: k(3) } })).toBe('collision S3');
    expect(what({ kind: 'timeLoss', where: { sector: k(2) } })).toBe('time loss S2');
  });

  it('an unknown sector leaves the kind alone', () => {
    expect(what({ where: { sector: unknown('notReceived') } })).toBe('collision');
  });

  it('a warning shows its count of the limit', () => {
    expect(what({ kind: 'warning', warning: { count: 2, limit: 3 }, where: { sector: k(2) } })).toBe('warning 2/3');
  });

  it('a damage entry names its parts and their rise through the kit part names', () => {
    expect(what({ kind: 'damage', damage: [{ part: 'floorPct', deltaPct: 8 }] })).toBe('damage floor +8 %');
    expect(what({ kind: 'damage', damage: [] })).toBe('damage');
  });

  it('a detail too long for the what column beside the kind word is shown alone: the part names say damage', () => {
    expect(what({ kind: 'damage', damage: [{ part: 'frontLeftWingPct', deltaPct: 12.4 }] })).toBe('FL wing +12 %');
    expect(what({ kind: 'damage', damage: [{ part: 'frontLeftWingPct', deltaPct: 12 }, { part: 'floorPct', deltaPct: 8 }] })).toBe('FL wing +12 %, floor +8 %');
  });

  it('other kinds show no sector', () => {
    expect(what({ kind: 'penalty', where: { sector: k(1) } })).toBe('penalty');
    expect(what({ kind: 'neutralised', where: { sector: unknown('notApplicable') } })).toBe('neutralised');
  });

  describe('a penalty entry names the penalty given (the PEN kind from incidents)', () => {
    const penalty = (detail: IncidentEntry['penalty']): string =>
      what({ kind: 'penalty', severity: 'minor', timeLostMs: unknown('notApplicable'), where: { sector: k(2) }, ...(detail && { penalty: detail }) });

    it('beside the kind word when both fit the what column: stop-go, a time penalty with the kit time, grid', () => {
      expect(penalty({ kind: 'stopGo' })).toBe('penalty stop-go');
      expect(penalty({ kind: 'time', timeMs: 5_000 })).toBe('penalty +5 s');
      expect(penalty({ kind: 'time', timeMs: 10_000 })).toBe('penalty +10 s');
      expect(penalty({ kind: 'grid' })).toBe('penalty grid');
    });

    it('alone when kind word and name do not fit: the name says it is a penalty', () => {
      expect(penalty({ kind: 'driveThrough' })).toBe('drive-through');
      expect(penalty({ kind: 'disqualified' })).toBe('disqualified');
      expect(penalty({ kind: 'tyreRegulations' })).toBe('tyre regulations');
    });

    it('a time penalty without its time, or an entry without the kind, is a bare penalty (no invented time)', () => {
      expect(penalty({ kind: 'time' })).toBe('penalty');
      expect(penalty(undefined)).toBe('penalty');
    });

    it('a full row of a drive-through keeps the grid', () => {
      const [row] = incidentRows([minor({ id: 'penalty:5:210000', kind: 'penalty', penalty: { kind: 'driveThrough' } })], cars, undefined);
      expect(incidentRowText('full', row!).trimEnd()).toBe(' L21  PIA      drive-through');
    });
  });

  it('full rows keep the grid with the detail, as the mockup', () => {
    const [row] = incidentRows([entry({ id: 't', kind: 'timeLoss', carIds: [carId(4)], timeLostMs: k(6100), where: { sector: k(2) },
      forUs: [forUs({ otherCarId: k(carId(4)), positionAfter: k(5), gapBeforeMs: k(-1900), gapAfterMs: k(5800) })] })], cars, undefined);
    expect(incidentRowText('full', row!, 70)).toBe(' L23  ALB      time loss S2        lost 6.1 s  us —, ALB −1.9→+5.8');
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

describe('fitRow', () => {
  const long = entry({
    carIds: [carId(4)],
    forUs: [forUs({ otherCarId: k(carId(4)), positionBefore: k(12), positionAfter: k(14), gapBeforeMs: k(12_300), gapAfterMs: k(14_100) })],
  });

  it('cuts a last cell that does not fit the line with …, never silently', () => {
    const [row] = incidentRows([long], cars, undefined);
    const cells = fitRow('full', row!, 70);
    const forUsCell = cells.find((c) => c.column === 'forUs')!;
    expect(row!.cells.forUs.text).toBe('us P12→P14, ALB +12.3→+14.1');
    expect(forUsCell.text).toBe('us P12→P14, ALB +12.3→…');
    expect(incidentRowText('full', row!, 70)).toHaveLength(70);
  });

  it('keeps the fixed columns at their widths and gives an empty value its reason in words', () => {
    const [row] = incidentRows([entry({ timeLostMs: unknown('insufficientData') })], cars, undefined);
    const cells = fitRow('full', row!, 70);
    expect(cells.map((c) => c.text.length).slice(0, 4)).toEqual([3, 7, 18, 10]);
    expect(cells.find((c) => c.column === 'lost')?.title).toBe('too few laps or samples yet');
    expect(cells.find((c) => c.column === 'lap')?.title).toBeUndefined();
  });
});
