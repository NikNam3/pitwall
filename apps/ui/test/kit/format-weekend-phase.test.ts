// The weekend phase in words, one place (SP4.3c Task 1, spec §5.3; C68): `formatWeekendPhase` gives the strings of
// today's three tables (the kit's `SESSION_KIND_LABEL`, `widgets/feed-status/presentation.ts`'s byFormat rows and
// `shell/topbar/session-presentation.ts`'s names) for every phase and format, `isSprintShootout` is the one test for
// the shootout formats, and `msToSeconds` the one ms → s conversion (`widgets/gap-chart/series.ts`). `SessionKind`
// goes: the readers use `WeekendPhase` with its format.
import { describe, expect, it } from 'vitest';
import { toSessionTime, type OpenSpan, type PracticeFormat, type QualifyingFormat, type RaceFormat, type WeekendPhase } from '@pitwall/domain';
import { formatWeekendPhase, isSprintShootout, msToSeconds } from '../../src/kit/values/format.ts';
import { sessionOf } from '../../src/shell/topbar/session-presentation.ts';
import { phaseLabel } from '../../src/widgets/feed-status/presentation.ts';

const PRACTICE: Record<PracticeFormat, string> = { practice: 'practice', shortPractice: 'practice' };
const QUALIFYING: Record<QualifyingFormat, string> = {
  grandPrix: 'qualifying',
  short: 'qualifying',
  oneShot: 'qualifying',
  sprintShootout: 'sprint shootout',
  shortSprintShootout: 'sprint shootout',
  oneShotSprintShootout: 'sprint shootout',
};
const RACE: Record<RaceFormat, string> = { grandPrix: 'race', sprint: 'sprint' };

describe('formatWeekendPhase', () => {
  const rows: Array<[WeekendPhase, string]> = [
    ...Object.entries(PRACTICE).map(([format, name]): [WeekendPhase, string] => [{ kind: 'practice', format: format as PracticeFormat, segment: undefined }, name]),
    ...Object.entries(QUALIFYING).map(([format, name]): [WeekendPhase, string] => [{ kind: 'qualifying', format: format as QualifyingFormat, segment: undefined }, name]),
    ...Object.entries(RACE).map(([format, name]): [WeekendPhase, string] => [{ kind: 'race', format: format as RaceFormat }, name]),
  ];

  for (const [phase, name] of rows) {
    it(`${phase.kind} with format ${'format' in phase ? phase.format : '-'} reads "${name}"`, () => {
      expect(formatWeekendPhase(phase)).toBe(name);
    });
  }

  it('a segment reads as the paddock names it: FP2, Q1, SQ3 for a shootout format', () => {
    expect(formatWeekendPhase({ kind: 'practice', format: 'practice', segment: 2 })).toBe('FP2');
    expect(formatWeekendPhase({ kind: 'qualifying', format: 'grandPrix', segment: 1 })).toBe('Q1');
    for (const format of ['sprintShootout', 'shortSprintShootout', 'oneShotSprintShootout'] as const) {
      expect(formatWeekendPhase({ kind: 'qualifying', format, segment: 3 })).toBe('SQ3');
    }
  });

  it('pending and none (a time trial or an unknown session type) have no name', () => {
    expect(formatWeekendPhase({ kind: 'pending' })).toBe('');
    expect(formatWeekendPhase({ kind: 'none' })).toBe('');
  });
});

// The two presentation tables map to the kit (plan Task 1: `widgets/feed-status/presentation.ts` and
// `shell/topbar/session-presentation.ts` map to `formatWeekendPhase`): for the weekend phase's open span without a
// segment, the feed status's session name and the top bar's session name are the kit's words. The top bar's name is
// a string now (it named a `SessionKind`), so a sprint race reads "sprint" there too.
describe('the presentation tables name the phase through the kit', () => {
  const spanOf = (phase: Exclude<WeekendPhase, { kind: 'pending' }>): OpenSpan => {
    const { kind, ...detail } = phase;
    return { machine: 'weekend-phase', id: 0, kind, start: toSessionTime(500), confirmed: true, detail, startFrame: 1 };
  };
  const phases: Array<Exclude<WeekendPhase, { kind: 'pending' | 'none' }>> = [
    ...(Object.keys(PRACTICE) as PracticeFormat[]).map((format) => ({ kind: 'practice' as const, format, segment: undefined })),
    ...(Object.keys(QUALIFYING) as QualifyingFormat[]).map((format) => ({ kind: 'qualifying' as const, format, segment: undefined })),
    ...(Object.keys(RACE) as RaceFormat[]).map((format) => ({ kind: 'race' as const, format })),
  ];

  for (const phase of phases) {
    it(`${phase.kind} with format ${phase.format}: feed status and top bar read "${formatWeekendPhase(phase)}"`, () => {
      expect(phaseLabel(spanOf(phase))).toBe(formatWeekendPhase(phase));
      expect(sessionOf(spanOf(phase))?.name).toBe(formatWeekendPhase(phase));
    });
  }

  it('none shows no name in either', () => {
    expect(phaseLabel(spanOf({ kind: 'none' }))).toBeUndefined();
    expect(sessionOf(spanOf({ kind: 'none' }))?.name).toBeUndefined();
  });
});

describe('isSprintShootout', () => {
  it('is true only for the qualifying phase with a shootout format', () => {
    for (const format of Object.keys(QUALIFYING) as QualifyingFormat[]) {
      expect([format, isSprintShootout({ kind: 'qualifying', format, segment: undefined })]).toEqual([format, QUALIFYING[format] === 'sprint shootout']);
    }
    const others: WeekendPhase[] = [
      { kind: 'pending' },
      { kind: 'none' },
      ...(Object.keys(PRACTICE) as PracticeFormat[]).map((format): WeekendPhase => ({ kind: 'practice', format, segment: 1 })),
      ...(Object.keys(RACE) as RaceFormat[]).map((format): WeekendPhase => ({ kind: 'race', format })),
    ];
    for (const phase of others) expect(isSprintShootout(phase)).toBe(false);
  });
});

describe('msToSeconds', () => {
  it('1234 ms is 1.234 s', () => {
    expect(msToSeconds(1234)).toBe(1.234);
  });

  it('keeps the sign and zero', () => {
    expect(msToSeconds(-2500)).toBe(-2.5);
    expect(msToSeconds(0)).toBe(0);
  });
});
