import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, IncidentForUs, Known, RaceMoment } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import type { CellPart } from '../../kit/grid/grid.ts';
import { columnsFor, fitRow, incidentRowText, incidentRows, type IncidentCell } from './rows.ts';

const k = <T>(v: T): Known<T> => known(v, 0);
const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(2, 'Esteban Ocon'), overview(3, 'Carlos Sainz'), overview(4, 'Alexander Albon'), overview(5, 'Oscar Piastri')];

const forUs = (over: Partial<IncidentForUs> = {}): IncidentForUs => ({
  ourCarId: carId(1), otherCarId: k(carId(2)), positionBefore: k(5), positionAfter: k(4), gapBeforeMs: k(4100), gapAfterMs: unknown('notApplicable'), ...over,
});
const entry = (over: Partial<IncidentEntry> = {}): IncidentEntry => ({
  id: 'collision:2+3:230000', at: toSessionTime(230_000), lap: 23, kind: 'collision', severity: 'major', carIds: [carId(2), carId(3)],
  timeLostMs: k(4200), forUs: [forUs()], where: { sector: unknown('notReceived'), turn: unknown('notApplicable'), fraction: unknown('notApplicable') }, ...over,
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
    expect(collision!.cells.forUs.text).toBe('KUH P5→P4, OCO +4.1→DNF');
    expect(timeLoss!.cells.forUs.text).toBe('KUH —, ALB −1.9→+5.8');
  });

  it('names the car the analysis measured the gaps to (otherCarId), not one it picks from the entry itself', () => {
    const [row] = incidentRows([entry({ carIds: [carId(1), carId(4)], forUs: [forUs({ otherCarId: k(carId(4)), gapBeforeMs: k(-1900), gapAfterMs: k(5800) })] })], cars, undefined);
    expect(row!.cells.forUs.text).toBe('KUH P5→P4, ALB −1.9→+5.8');
    expect(row!.cells.cars.text).toBe('KUH ALB');
    const [second] = incidentRows([entry({ forUs: [forUs({ otherCarId: k(carId(3)) })] })], cars, undefined);
    expect(second!.cells.forUs.text).toBe('KUH P5→P4, SAI +4.1→DNF');
  });

  it('shows no gap part when the entry has no other car (otherCarId notApplicable)', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ otherCarId: unknown('notApplicable'), gapBeforeMs: unknown('notApplicable') })] })], cars, undefined);
    expect(row!.cells.forUs).toMatchObject({ text: 'KUH P5→P4' });
    expect(row!.cells.forUs.reason).toBeUndefined();
  });

  it('keeps the known position after an unknown position before, with the before\'s reason on hover (no invented position)', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: unknown('notReceived') })] })], cars, undefined);
    expect(row!.cells.forUs).toMatchObject({ text: 'KUH →P4, OCO +4.1→DNF', reason: 'notReceived' });
  });


  it('gives an unknown gap after its reason on hover; DNF (not applicable) needs none', () => {
    const [waiting] = incidentRows([entry({ forUs: [forUs({ gapAfterMs: unknown('notReceived') })] })], cars, undefined);
    expect(waiting!.cells.forUs).toMatchObject({ text: 'KUH P5→P4, OCO +4.1→', reason: 'notReceived' });
    const [retired] = incidentRows([entry()], cars, undefined);
    expect(retired!.cells.forUs.reason).toBeUndefined();
  });

  it('writes a position change as P7→P9 through the position mark', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: k(7), positionAfter: k(9) })] })], cars, undefined);
    expect(row!.cells.forUs.text.startsWith('KUH P7→P9')).toBe(true);
  });

  it('writes P7→ while the position after is unknown', () => {
    const [row] = incidentRows([entry({ forUs: [forUs({ positionBefore: k(7), positionAfter: unknown('insufficientData') })] })], cars, undefined);
    expect(row!.cells.forUs.text.startsWith('KUH P7→,')).toBe(true);
  });

  it('keeps the other car and the arrow when both gaps are unknown, each mark in its place; the cell is empty without forUs', () => {
    const [a, b] = incidentRows(
      [entry({ forUs: [forUs({ gapBeforeMs: unknown('insufficientData'), gapAfterMs: unknown('insufficientData') })] }), minor()],
      cars, undefined);
    expect(a!.cells.forUs).toMatchObject({ text: 'KUH P5→P4, OCO →', reason: 'insufficientData' });
    expect(a!.cells.forUs.parts?.filter((p) => p.reason !== undefined).map((p) => p.reason)).toEqual(['insufficientData', 'insufficientData']);
    expect(b!.cells.forUs.text).toBe('');
  });

  // One builder of the for-us cell (review 2, F7; review 4, W2): the cell is pieces, each a value with its own leading
  // separator (`KUH`, ` P5→P4`, `, OCO`, ` +4.1→DNF`; between our cars ` · `). The parts show every piece, an unknown value
  // as its mark after its separator; the plain text joins the known pieces' texts, so an unknown value leaves with its
  // separator and nothing is patched afterwards. A pair (`P5→P4`, `+4.1→DNF`) is one piece: an unknown side leaves the
  // arrow and the pair keeps its separator; the arrow stays when both sides are unknown. The position pair and the gap
  // pair follow one rule (review 5, R5): an unknown position before keeps the known position after (`…→P4`).
  describe('the for-us cell is built from its pieces', () => {
    /** A cell's plain text and, when it has an unknown value, its parts as one line with `‹reason›` at each mark. */
    type Expected = { text: string; parts?: string };
    const marked = (parts: readonly CellPart[]): string => parts.map((p) => (p.reason === undefined ? p.text : `‹${p.reason}›`)).join('');
    const cellOf = (list: IncidentForUs[]): IncidentCell => incidentRows([entry({ forUs: list })], cars, undefined)[0]!.cells.forUs;

    const expectCell = (cell: IncidentCell, { text, parts }: Expected): void => {
      expect(cell.text).toBe(text);
      expect(cell.text, 'no leading, trailing or double space').not.toMatch(/^ | $| {2}/);
      if (parts === undefined) {
        expect(cell.parts, 'a known cell shows its text alone').toBeUndefined();
        expect(cell.reason).toBeUndefined();
        return;
      }
      expect(cell.parts, 'an unknown value has its part').toBeDefined();
      expect(marked(cell.parts!)).toBe(parts);
      expect(cell.parts!.filter((p) => p.reason !== undefined).every((p) => p.text === ''), 'a mark stands alone in its part').toBe(true);
      expect(cell.reason, 'the hover gives the first mark\'s reason').toBe(/‹(\w+)›/.exec(parts)?.[1]);
    };

    const none = unknown('notApplicable');
    const before = { known: k(5), unknown: unknown('notReceived') };
    const after = { known: k(4), unknown: unknown('insufficientData') };
    const other = {
      present: { otherCarId: k(carId(2)), gapBeforeMs: k(4100), gapAfterMs: none },
      absent: { otherCarId: none, gapBeforeMs: none, gapAfterMs: none },
    };
    /** Every combination of the position before and after, and the other car, for one of our cars. */
    const matrix: [keyof typeof before, keyof typeof after, keyof typeof other, Expected][] = [
      ['known', 'known', 'present', { text: 'KUH P5→P4, OCO +4.1→DNF' }],
      ['known', 'unknown', 'present', { text: 'KUH P5→, OCO +4.1→DNF', parts: 'KUH P5→‹insufficientData›, OCO +4.1→DNF' }],
      ['unknown', 'known', 'present', { text: 'KUH →P4, OCO +4.1→DNF', parts: 'KUH ‹notReceived›→P4, OCO +4.1→DNF' }],
      ['unknown', 'unknown', 'present', { text: 'KUH →, OCO +4.1→DNF', parts: 'KUH ‹notReceived›→‹insufficientData›, OCO +4.1→DNF' }],
      ['known', 'known', 'absent', { text: 'KUH P5→P4' }],
      ['known', 'unknown', 'absent', { text: 'KUH P5→', parts: 'KUH P5→‹insufficientData›' }],
      ['unknown', 'known', 'absent', { text: 'KUH →P4', parts: 'KUH ‹notReceived›→P4' }],
      ['unknown', 'unknown', 'absent', { text: 'KUH →', parts: 'KUH ‹notReceived›→‹insufficientData›' }],
    ];
    const ofCombination = (b: keyof typeof before, a: keyof typeof after, o: keyof typeof other): IncidentForUs =>
      forUs({ positionBefore: before[b], positionAfter: after[a], ...other[o] });

    it.each(matrix)('position before %s, after %s, other car %s: one of our cars', (b, a, o, expected) => {
      expectCell(cellOf([ofCombination(b, a, o)]), expected);
    });

    /** The second of our cars, known and alone: `KUH —`. */
    const teammate = forUs({ ourCarId: carId(5), positionBefore: k(7), positionAfter: k(7), ...other.absent });
    const teammateExpected: Expected = { text: 'PIA —' };
    /** Two of our cars one after the other: each its own, ` · ` between them. */
    /** The expectation of the second car (Piastri, car 5): its code leads the cell, not the player's. */
    const asPia = (e: Expected): Expected => ({ text: e.text.replace(/^KUH/, 'PIA'), ...(e.parts === undefined ? {} : { parts: e.parts.replace(/^KUH/, 'PIA') }) });
    const joined = (x: Expected, y: Expected): Expected => {
      const text = `${x.text} · ${y.text}`;
      return x.parts === undefined && y.parts === undefined ? { text } : { text, parts: `${x.parts ?? x.text} · ${y.parts ?? y.text}` };
    };

    it.each(matrix)('position before %s, after %s, other car %s: first of our two cars', (b, a, o, expected) => {
      expectCell(cellOf([ofCombination(b, a, o), teammate]), joined(expected, teammateExpected));
    });

    it.each(matrix)('position before %s, after %s, other car %s: second of our two cars', (b, a, o, expected) => {
      expectCell(cellOf([teammate, { ...ofCombination(b, a, o), ourCarId: carId(5) }]), joined(teammateExpected, asPia(expected)));
    });

    it.each(matrix)('position before %s, after %s, other car %s: both of our two cars', (b, a, o, expected) => {
      expectCell(cellOf([ofCombination(b, a, o), { ...ofCombination(b, a, o), ourCarId: carId(5) }]), joined(expected, asPia(expected)));
    });

    // the other car's piece and its gap pair
    const gapCases: Record<string, { list: IncidentForUs[] } & Expected> = {
      'gap after not received': {
        list: [forUs({ gapAfterMs: unknown('notReceived') })], text: 'KUH P5→P4, OCO +4.1→', parts: 'KUH P5→P4, OCO +4.1→‹notReceived›',
      },
      'gap before unknown': {
        list: [forUs({ gapBeforeMs: unknown('insufficientData'), gapAfterMs: k(5800) })], text: 'KUH P5→P4, OCO →+5.8', parts: 'KUH P5→P4, OCO ‹insufficientData›→+5.8',
      },
      'both gaps unknown': {
        list: [forUs({ gapBeforeMs: unknown('insufficientData'), gapAfterMs: unknown('realism') })],
        text: 'KUH P5→P4, OCO →', parts: 'KUH P5→P4, OCO ‹insufficientData›→‹realism›',
      },
      'position before and gap after unknown': {
        list: [forUs({ positionBefore: unknown('notReceived'), gapAfterMs: unknown('notReceived') })],
        text: 'KUH →P4, OCO +4.1→', parts: 'KUH ‹notReceived›→P4, OCO +4.1→‹notReceived›',
      },
      // the code is a value like any other: missing from the field, it leaves with its separator `, `
      'other car missing from the field, gap after unknown': {
        list: [forUs({ otherCarId: k(carId(9)), gapAfterMs: unknown('notReceived') })],
        text: 'KUH P5→P4 +4.1→', parts: 'KUH P5→P4, ‹notReceived› +4.1→‹notReceived›',
      },
    };

    it.each(Object.entries(gapCases))('%s', (_name, { list, ...expected }) => {
      expectCell(cellOf(list), expected);
    });
  });

  // Our cars are named by their driver code, never by a stand-in word (`us`): the player's own code too.
  describe('our cars by driver code', () => {
    const field = [...cars, overview(6, 'George Russell')];
    const ours = (over: Partial<IncidentForUs>): IncidentForUs =>
      forUs({ otherCarId: unknown('notApplicable'), gapBeforeMs: unknown('notApplicable'), ...over });
    const cell = (list: IncidentForUs[]): IncidentCell => incidentRows([entry({ forUs: list })], field, undefined)[0]!.cells.forUs;

    it('an entry for our teammate reads RUS P6→P7', () => {
      expect(cell([ours({ ourCarId: carId(6), positionBefore: k(6), positionAfter: k(7) })]).text).toBe('RUS P6→P7');
    });

    it('an entry for the player reads its own code, never us', () => {
      const text = cell([ours({ ourCarId: carId(1) })]).text;
      expect(text).toBe('KUH P5→P4');
      expect(text).not.toMatch(/\bus\b/);
    });

    it('both our cars read their own codes, one after the other', () => {
      expect(cell([ours({ ourCarId: carId(1) }), ours({ ourCarId: carId(6), positionBefore: k(6), positionAfter: k(7) })]).text).toBe('KUH P5→P4 · RUS P6→P7');
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
    expect(what({ where: { sector: k(3), turn: unknown('notApplicable'), fraction: unknown('notApplicable') } })).toBe('collision S3');
    expect(what({ kind: 'timeLoss', where: { sector: k(2), turn: unknown('notApplicable'), fraction: unknown('notApplicable') } })).toBe('time loss S2');
  });

  it('an unknown sector leaves the kind alone', () => {
    expect(what({ where: { sector: unknown('notReceived'), turn: unknown('notApplicable'), fraction: unknown('notApplicable') } })).toBe('collision');
  });

  describe('a warning names its kind (cells.what.text, before the grid fits it)', () => {
    const warned = (warning: NonNullable<IncidentEntry['warning']>): string => what({ kind: 'warning', warning, where: { sector: k(2), turn: unknown('notApplicable'), fraction: unknown('notApplicable') } });
    /** Another infringement's warning: no count. */
    const other = (infringement: Known<number>): NonNullable<IncidentEntry['warning']> => ({ kind: 'other', infringement });

    it('corner cutting shows its count of the limit', () => {
      expect(warned({ kind: 'cornerCutting', count: 2, limit: 3 })).toBe('warning · corner cutting 2/3');
    });

    it('another infringement shows its name from the kit, never a count', () => {
      expect(warned(other(k(4)))).toBe('warning · collision');
      expect(warned(other(k(12)))).toBe('warning · ignored yellow flags');
    });

    it('never shows a count for another infringement', () => {
      expect(warned(other(k(4)))).not.toMatch(/\d\/\d/);
      expect(warned(other(unknown('notReceived')))).not.toMatch(/\d\/\d/);
    });

    it('an infringement we cannot name, or an unknown one, reads warning', () => {
      expect(warned(other(k(999)))).toBe('warning');
      expect(warned(other(unknown('notReceived')))).toBe('warning');
    });
  });

  it('a damage entry names its parts and their rise through the kit part names', () => {
    expect(what({ kind: 'damage', damage: [{ part: 'floorPct', deltaPct: 8 }] })).toBe('damage floor +8 %');
    expect(what({ kind: 'damage', damage: [] })).toBe('damage');
  });

  it('a detail too long for the what column beside the kind word is shown alone: the part names say damage', () => {
    expect(what({ kind: 'damage', damage: [{ part: 'frontLeftWingPct', deltaPct: 12.4 }] })).toBe('FL wing +12 %');
    expect(what({ kind: 'damage', damage: [{ part: 'frontLeftWingPct', deltaPct: 12 }, { part: 'floorPct', deltaPct: 8 }] })).toBe('FL wing +12 %, floor +8 %');
  });

  describe('a neutralised entry names its cause', () => {
    const field = [...cars, overview(6, 'Fernando Alonso'), overview(7, 'Yuki Tsunoda')];
    const neutralised = (over: Partial<IncidentEntry> = {}): IncidentEntry =>
      entry({ id: 'neutralised:230000', kind: 'neutralised', carIds: [], forUs: [], timeLostMs: unknown('notApplicable'), where: { sector: unknown('notApplicable'), turn: unknown('notApplicable'), fraction: unknown('notApplicable') }, ...over });
    const whatOf = (e: IncidentEntry): string => incidentRows([e], field, undefined)[0]!.cells.what.text;

    it('a neutralised entry with a cause shows its cars and kind', () => {
      const cause = { entryId: 'collision:6+7:228000', kind: 'collision', carIds: [carId(6), carId(7)], at: toSessionTime(228_000) } as const;
      expect(whatOf(neutralised({ neutralisation: 'SC', cause: { ...cause, carIds: [...cause.carIds] } }))).toBe('SC · ALO–TSU collision');
    });

    it('a retirement cause names its one car and kind', () => {
      const cause = { entryId: 'retirement:6:228000', kind: 'retirement', carIds: [carId(6)], at: toSessionTime(228_000) } as const;
      expect(whatOf(neutralised({ neutralisation: 'SC', cause: { ...cause, carIds: [...cause.carIds] } }))).toBe('SC · ALO retirement');
    });

    it('a VSC neutralisation with a cause', () => {
      const cause = { entryId: 'collision:6+7:228000', kind: 'collision', carIds: [carId(6), carId(7)], at: toSessionTime(228_000) } as const;
      expect(whatOf(neutralised({ neutralisation: 'VSC', cause: { ...cause, carIds: [...cause.carIds] } }))).toBe('VSC · ALO–TSU collision');
    });

    it('a red flag with a cause (the RED phase word)', () => {
      const cause = { entryId: 'collision:6+7:228000', kind: 'collision', carIds: [carId(6), carId(7)], at: toSessionTime(228_000) } as const;
      expect(whatOf(neutralised({ neutralisation: 'red', cause: { ...cause, carIds: [...cause.carIds] } }))).toBe('RED · ALO–TSU collision');
    });

    it('without a cause it reads as today', () => {
      expect(whatOf(neutralised())).toBe('neutralised');
    });
  });

  it('other kinds show no sector', () => {
    expect(what({ kind: 'penalty', where: { sector: k(1), turn: unknown('notApplicable'), fraction: unknown('notApplicable') } })).toBe('penalty');
    expect(what({ kind: 'neutralised', where: { sector: unknown('notApplicable'), turn: unknown('notApplicable'), fraction: unknown('notApplicable') } })).toBe('neutralised');
  });

  describe('a penalty entry names the penalty given (the PEN kind from incidents)', () => {
    const penalty = (detail: IncidentEntry['penalty']): string =>
      what({ kind: 'penalty', severity: 'minor', timeLostMs: unknown('notApplicable'), where: { sector: k(2), turn: unknown('notApplicable'), fraction: unknown('notApplicable') }, ...(detail && { penalty: detail }) });

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
    const [row] = incidentRows([entry({ id: 't', kind: 'timeLoss', carIds: [carId(4)], timeLostMs: k(6100), where: { sector: k(2), turn: unknown('notApplicable'), fraction: unknown('notApplicable') },
      forUs: [forUs({ otherCarId: k(carId(4)), positionAfter: k(5), gapBeforeMs: k(-1900), gapAfterMs: k(5800) })] })], cars, undefined);
    expect(incidentRowText('full', row!, 70)).toBe(' L23  ALB      time loss S2        lost 6.1 s  KUH —, ALB −1.9→+5.8');
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
    expect(incidentRowText('full', a!)).toBe(' L23  OCO SAI  collision           lost 4.2 s  KUH P5→P4, OCO +4.1→DNF');
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
    expect(row!.cells.forUs.text).toBe('KUH P12→P14, ALB +12.3→+14.1');
    expect(forUsCell.text).toBe('KUH P12→P14, ALB +12.3…');
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
