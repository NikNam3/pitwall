import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { weekendPhaseSpans } from '@pitwall/domain';
import { classifyLap, isNeutralisedLap, LAP_CLASSES_CONFIG, lapPhaseRowOf, RACE_LAP_PHASE_ROWS, touchesNeutralisation } from '../../src/lap-classes/index.ts';
import { lapClassOf } from '../../src/degradation/stint-fit.ts';
import { excludedLap, RACE_INTERACTION_CONFIG } from '../../src/race-interaction/index.ts';
import { engineView, history, lap, neutralisation } from '../../../../test-support/builders/index.ts';

const LIMIT = LAP_CLASSES_CONFIG.defaults.maxNeutralisedMs;
const race = { isRace: true, maxNeutralisedMs: LIMIT };
const practice = { isRace: false, maxNeutralisedMs: LIMIT };
const qualifying = { isRace: false, maxNeutralisedMs: LIMIT };

describe('classifyLap', () => {
  it('a clean lap counts for pace, rate, bands and best', () => {
    expect(classifyLap(lap({ lapNumber: 3 }), race)).toEqual({
      forPace: true,
      forRate: true,
      forBands: true,
      forBest: { lap: true, sectors: [true, true, true] },
    });
  });

  it('in lap and out lap count for neither pace nor rate', () => {
    for (const over of [{ inLap: true }, { outLap: true }]) {
      const c = classifyLap(lap({ lapNumber: 3, ...over }), race);
      expect(c.forPace).toBe(false);
      expect(c.forRate).toBe(false);
    }
  });

  it('a lap may have up to 2 s neutralised by default (user ruling 2026-10-30: the game`s flag lag at restarts)', () => {
    expect(LAP_CLASSES_CONFIG.key).toBe('lap-classes');
    expect(LAP_CLASSES_CONFIG.defaults).toEqual({ maxNeutralisedMs: 2000 });
  });

  it('a lap with 0.9 s under SC (the flag lag at a restart: scShare 0.01 of 90 s) counts for pace and rate', () => {
    const c = classifyLap(lap({ lapNumber: 5, lapTimeMs: 90_000, scShare: 0.01 }), race);
    expect(c.forRate).toBe(true);
    expect(c.forPace).toBe(true);
  });

  it('a lap with 0.9 s under VSC counts for pace and rate', () => {
    const c = classifyLap(lap({ lapNumber: 5, lapTimeMs: 90_000, vscShare: 0.01 }), race);
    expect(c.forRate).toBe(true);
    expect(c.forPace).toBe(true);
  });

  it('a lap with 9 s under SC or VSC (share 0.1 of 90 s) counts for neither pace nor rate', () => {
    for (const over of [{ scShare: 0.1 }, { vscShare: 0.1 }]) {
      const c = classifyLap(lap({ lapNumber: 3, lapTimeMs: 90_000, ...over }), race);
      expect(c.forPace).toBe(false);
      expect(c.forRate).toBe(false);
    }
  });

  it('exactly 2 s under SC does not count: the neutralised time must stay below the limit', () => {
    // 0.025 of 80 s is 2 000 ms
    const c = classifyLap(lap({ lapNumber: 3, lapTimeMs: 80_000, scShare: 0.025 }), race);
    expect(c.forRate).toBe(false);
    expect(c.forPace).toBe(false);
  });

  it('the neutralised time is the share times the lap time: the same share counts on a short lap, not on a long one', () => {
    // 0.015 of 100 s is 1.5 s; of 150 s it is 2.25 s
    expect(classifyLap(lap({ lapNumber: 3, lapTimeMs: 100_000, scShare: 0.015 }), race).forRate).toBe(true);
    expect(classifyLap(lap({ lapNumber: 3, lapTimeMs: 150_000, scShare: 0.015 }), race).forRate).toBe(false);
  });

  it('SC and VSC time add up: 1 s of each on one lap is 2 s neutralised and does not count', () => {
    const each = { lapNumber: 3, lapTimeMs: 100_000 };
    expect(classifyLap(lap({ ...each, scShare: 0.01 }), race).forRate).toBe(true);
    expect(classifyLap(lap({ ...each, vscShare: 0.01 }), race).forRate).toBe(true);
    expect(classifyLap(lap({ ...each, scShare: 0.01, vscShare: 0.01 }), race).forRate).toBe(false);
  });

  it('the limit is the caller`s maxNeutralisedMs', () => {
    const l = lap({ lapNumber: 3, lapTimeMs: 90_000, scShare: 0.01 }); // 0.9 s
    expect(classifyLap(l, { isRace: true, maxNeutralisedMs: 500 }).forRate).toBe(false);
    expect(classifyLap(l, { isRace: true, maxNeutralisedMs: 1000 }).forRate).toBe(true);
  });

  it('an in or out lap without neutralised time does not count, whatever the limit', () => {
    const lenient = { isRace: true, maxNeutralisedMs: 100_000 };
    expect(classifyLap(lap({ lapNumber: 3, inLap: true }), lenient).forRate).toBe(false);
    expect(classifyLap(lap({ lapNumber: 3, outLap: true }), lenient).forRate).toBe(false);
  });

  it('an invalid lap counts for rate but not for pace or best; its valid sectors count for best', () => {
    const c = classifyLap(lap({ lapNumber: 3, valid: { lap: false, sectors: [true, false, true] } }), race);
    expect(c.forRate).toBe(true);
    expect(c.forPace).toBe(false);
    expect(c.forBest).toEqual({ lap: false, sectors: [true, false, true] });
  });

  it('lap 1 of a race is not a pace lap; lap 1 of practice is', () => {
    expect(classifyLap(lap({ lapNumber: 1 }), race).forPace).toBe(false);
    expect(classifyLap(lap({ lapNumber: 1 }), race).forRate).toBe(true);
    expect(classifyLap(lap({ lapNumber: 1 }), practice).forPace).toBe(true);
    expect(classifyLap(lap({ lapNumber: 2 }), race).forPace).toBe(true);
  });

  describe('forBands: a rate lap that is not lap 1 of a race, valid or not (the laps car-bands and alarms judge, C43)', () => {
    it('an invalid rate lap counts for bands: a cut does not change the temperatures', () => {
      const c = classifyLap(lap({ lapNumber: 3, valid: { lap: false, sectors: [true, false, true] } }), race);
      expect(c.forRate).toBe(true);
      expect(c.forPace).toBe(false);
      expect(c.forBands).toBe(true);
    });

    it('lap 1 of a race does not count for bands, though it is a rate lap', () => {
      const c = classifyLap(lap({ lapNumber: 1 }), race);
      expect(c.forRate).toBe(true);
      expect(c.forBands).toBe(false);
    });

    it('lap 1 of qualifying and of practice counts for bands', () => {
      expect(classifyLap(lap({ lapNumber: 1 }), qualifying).forBands).toBe(true);
      expect(classifyLap(lap({ lapNumber: 1 }), practice).forBands).toBe(true);
    });

    it('lap 2 of a race counts for bands', () => {
      expect(classifyLap(lap({ lapNumber: 2 }), race).forBands).toBe(true);
    });

    it('an in lap and an out lap do not count for bands, in a race or not', () => {
      for (const opts of [race, qualifying]) {
        expect(classifyLap(lap({ lapNumber: 3, inLap: true }), opts).forBands).toBe(false);
        expect(classifyLap(lap({ lapNumber: 3, outLap: true }), opts).forBands).toBe(false);
      }
    });

    it('a lap with 9 s under SC does not count for bands: it is no rate lap', () => {
      expect(classifyLap(lap({ lapNumber: 3, lapTimeMs: 90_000, scShare: 0.1 }), race).forBands).toBe(false);
    });
  });

  const lapArb = fc.record({
    lapNumber: fc.integer({ min: 1, max: 80 }),
    lapTimeMs: fc.integer({ min: 60_000, max: 150_000 }),
    inLap: fc.boolean(),
    outLap: fc.boolean(),
    scShare: fc.double({ min: 0, max: 1, noNaN: true }),
    vscShare: fc.double({ min: 0, max: 1, noNaN: true }),
    valid: fc.record({ lap: fc.boolean(), sectors: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()) }),
  });
  const limitArb = fc.integer({ min: 0, max: 10_000 });

  it('property: forPace implies forRate', () => {
    fc.assert(
      fc.property(lapArb, fc.boolean(), limitArb, (over, isRace, maxNeutralisedMs) => {
        const c = classifyLap(lap(over), { isRace, maxNeutralisedMs });
        return !c.forPace || c.forRate;
      }),
    );
  });

  it('property: forBands is forRate except on lap 1 of a race; validity does not matter', () => {
    fc.assert(
      fc.property(lapArb, fc.boolean(), limitArb, (over, isRace, maxNeutralisedMs) => {
        const c = classifyLap(lap(over), { isRace, maxNeutralisedMs });
        return c.forBands === (c.forRate && !(isRace && over.lapNumber === 1));
      }),
    );
  });

  it('property: forPace implies forBands, and forBands implies forRate', () => {
    fc.assert(
      fc.property(lapArb, fc.boolean(), limitArb, (over, isRace, maxNeutralisedMs) => {
        const c = classifyLap(lap(over), { isRace, maxNeutralisedMs });
        return (!c.forPace || c.forBands) && (!c.forBands || c.forRate);
      }),
    );
  });

  it('property: a rate lap is neither an in nor an out lap and has less neutralised time than the limit', () => {
    fc.assert(
      fc.property(lapArb, fc.boolean(), limitArb, (over, isRace, maxNeutralisedMs) => {
        const neutralisedMs = (over.scShare + over.vscShare) * over.lapTimeMs;
        const expected = !over.inLap && !over.outLap && neutralisedMs < maxNeutralisedMs;
        return classifyLap(lap(over), { isRace, maxNeutralisedMs }).forRate === expected;
      }),
    );
  });
});

// SP4.3c Task 5 (O7, spec §5.3; C14, C43): `lap-classes` owns which laps count. Two rules, each by name: the threshold
// rule (`isNeutralisedLap`: neutralised time reaching `maxNeutralisedMs`) for the units that tolerate the flag lag, and
// `touchesNeutralisation` (any SC or VSC share) for the readers that mean "any SC"; and one set of weekend-phase rows
// (`RACE_LAP_PHASE_ROWS`) with the pending phase read as the race (`lapPhaseRowOf`, C14: readers treat it as the grid).
describe('touchesNeutralisation (any SC or VSC share)', () => {
  const view = engineView();

  it('a lap with any SC or VSC share touches a neutralisation, a lap with none does not', () => {
    expect(touchesNeutralisation(lap({ lapNumber: 5, lapTimeMs: 90_000 }), view)).toBe(false);
    expect(touchesNeutralisation(lap({ lapNumber: 5, lapTimeMs: 90_000, scShare: 0.001 }), view)).toBe(true);
    expect(touchesNeutralisation(lap({ lapNumber: 5, lapTimeMs: 90_000, vscShare: 0.001 }), view)).toBe(true);
    expect(touchesNeutralisation(lap({ lapNumber: 5, lapTimeMs: 90_000, scShare: 0.5, vscShare: 0.5 }), view)).toBe(true);
  });

  it("the lap record's shares decide, as the readers' filters did (no number changes): a lap without a share touches none", () => {
    const withSc = engineView({ history: history({ spans: { 'session-phase-race': [neutralisation({ start: 0, end: 600_000 })] } }) });
    expect(touchesNeutralisation(lap({ lapNumber: 5, completedAt: 450_000, frame: 450_000 }), withSc)).toBe(false);
    expect(touchesNeutralisation(lap({ lapNumber: 5, completedAt: 450_000, frame: 450_000, scShare: 0.2 }), withSc)).toBe(true);
  });
});

describe('the two neutralised-lap rules are declared, not copied (SP4.3c Task 5)', () => {
  // 0.5 s of SC on a 90 s lap: below the 2 000 ms flag-lag limit, but a share above 0
  const halfSecond = lap({ lapNumber: 5, lapTimeMs: 90_000, scShare: 500 / 90_000, completedAt: 450_000, frame: 450_000 });
  const view = engineView();

  it('the lap touches a neutralisation, but is no neutralised lap by the threshold rule', () => {
    expect(touchesNeutralisation(halfSecond, view)).toBe(true);
    expect(isNeutralisedLap(halfSecond, { maxNeutralisedMs: LIMIT })).toBe(false);
  });

  it('race-interaction excludes it (any SC: touchesNeutralisation); degradation keeps it as a pace lap (isNeutralisedLap under 2000 ms)', () => {
    const ctx = { source: { history: history({}) }, config: RACE_INTERACTION_CONFIG.defaults };
    expect(excludedLap(halfSecond, ctx)).toBe(true);
    expect(excludedLap({ ...halfSecond, scShare: 0 }, ctx)).toBe(false);
    expect(lapClassOf(halfSecond, race)).toBe('pace');
  });
});

describe('RACE_LAP_PHASE_ROWS and lapPhaseRowOf (C14)', () => {
  it('one row per weekend-phase kind; only the race has the lap-1 rule', () => {
    expect(Object.keys(RACE_LAP_PHASE_ROWS).sort()).toEqual([...weekendPhaseSpans.kinds].sort());
    expect(RACE_LAP_PHASE_ROWS).toEqual({ practice: { isRace: false }, qualifying: { isRace: false }, race: { isRace: true }, none: { isRace: false } });
  });

  it('a pending weekend phase reads as the race: its row is the race row; every decided phase gets its own row', () => {
    expect(lapPhaseRowOf(RACE_LAP_PHASE_ROWS, 'pending')).toBe(RACE_LAP_PHASE_ROWS.race);
    for (const kind of weekendPhaseSpans.kinds) expect(lapPhaseRowOf(RACE_LAP_PHASE_ROWS, kind)).toBe(RACE_LAP_PHASE_ROWS[kind]);
  });

  it("lapPhaseRowOf reads a unit's own rows (spread from RACE_LAP_PHASE_ROWS) the same way: pending gets the unit's race row", () => {
    const rows = {
      practice: { ...RACE_LAP_PHASE_ROWS.practice, measured: true },
      qualifying: { ...RACE_LAP_PHASE_ROWS.qualifying, measured: true },
      race: { ...RACE_LAP_PHASE_ROWS.race, measured: true },
      none: { ...RACE_LAP_PHASE_ROWS.none, measured: false },
    };
    expect(lapPhaseRowOf(rows, 'pending')).toBe(rows.race);
    expect(lapPhaseRowOf(rows, 'none')).toBe(rows.none);
  });
});
