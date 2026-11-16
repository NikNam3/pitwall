// One set of weekend-phase lap rows (SP4.3c Task 5, O7, B10; contract C14, C43, C44, C87): one generic test over every
// unit folder's behaviour table (`loadUnitFolders`). A unit whose `weekend-phase` rows say whether lap 1 counts (an
// `isRace` field) spreads `lap-classes`' `RACE_LAP_PHASE_ROWS`, so every kind's row agrees with them, and reads the
// pending weekend phase as the race (`lapPhaseRowOf`, C14: until the weekend structure arrives readers treat the session
// as on the grid). No unit keeps private `isRace` rows; the units that kept them (the plan's list) are all found here.
import { weekendPhaseSpans } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { engineView } from '../../../../test-support/builders/index.ts';
import { judgedLapClasses } from '../../src/car-bands/bands.ts';
import { lapPhaseRowOf, RACE_LAP_PHASE_ROWS } from '../../src/lap-classes/index.ts';
import { NONE, openSpan, PRACTICE, QUALIFYING, RACE } from '../situated.ts';
import { loadUnitFolders } from '../units.ts';

/** The units whose weekend-phase rows (or private phase checks) said whether lap 1 counts before Task 5 (`git grep isRace`). */
const LAP_PHASE_UNITS = [
  'alarms',
  'car-bands',
  'crossover',
  'damage',
  'degradation',
  'driver-noise',
  'lap-overview',
  'lap-times',
  'pit-loss',
  'raising-average',
  'track-wetness',
] as const;

type Rows = Readonly<Record<string, unknown>>;

const folders = await loadUnitFolders();

/** Each unit's `weekend-phase` rows, for the units whose rows carry `isRace`. */
const lapPhaseTables = folders.flatMap(({ unit, table }) => {
  const rows = table?.['weekend-phase'] as Rows | undefined;
  if (rows === undefined) return [];
  const carries = Object.values(rows).some((row) => typeof row === 'object' && row !== null && 'isRace' in row);
  return carries ? [{ unit, rows }] : [];
});

describe('weekend-phase lap rows: one set, pending reads as the race (C14, C43, B10)', () => {
  it("every unit that judged lap 1 by the weekend phase carries the rows in its behaviour table's weekend-phase part", () => {
    expect(lapPhaseTables.map((t) => t.unit).sort()).toEqual(expect.arrayContaining([...LAP_PHASE_UNITS]));
  });

  for (const { unit, rows } of lapPhaseTables) {
    it(`${unit}: every weekend-phase row spreads RACE_LAP_PHASE_ROWS`, () => {
      for (const kind of weekendPhaseSpans.kinds) expect(rows[kind], `${unit} ${kind}`).toMatchObject(RACE_LAP_PHASE_ROWS[kind]);
    });

    it(`${unit}: a pending weekend phase gives its race row`, () => {
      expect(lapPhaseRowOf(rows as Record<(typeof weekendPhaseSpans.kinds)[number], unknown>, 'pending')).toBe(rows['race']);
    });
  }
});

describe("car-bands' judged lap follows the race rows while the weekend phase is pending (B10)", () => {
  const viewIn = (phase: EngineView['situation']['weekendPhase']): EngineView => {
    if (phase.kind === 'pending') return engineView({ situation: { weekendPhase: phase, byMachine: {} } });
    const { kind, ...detail } = phase;
    return engineView({ situation: { weekendPhase: phase, byMachine: { 'weekend-phase': [openSpan('weekend-phase', kind, { detail })] } } });
  };

  it('pending and race: lap 1 of a race is not judged; practice, qualifying and none: it is', () => {
    expect(judgedLapClasses(viewIn({ kind: 'pending' })).isRace).toBe(true);
    expect(judgedLapClasses(viewIn(RACE)).isRace).toBe(true);
    for (const phase of [PRACTICE, QUALIFYING, NONE]) expect(judgedLapClasses(viewIn(phase)).isRace, phase.kind).toBe(false);
  });
});
