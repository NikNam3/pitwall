// The plan-board declaration and gallery (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html:
// full 82×13, compact 37×7; C74: `plan.save`, `plan.activate`, `plan.remove`; SP4.3d2 Task 12: the panel option
// `source: auto | live | planning`, the planning round's topics and its six commands, C72). The gallery holds data states only; a selection, the slot picker and an edit draft are
// window-local (C73), component tests.
import { carId, feedId, PLAN_SLOTS } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { caseOptions, cases, fit } from './fixtures.ts';
import { widget } from './widget.ts';

describe('plan-board declaration', () => {
  it('is named plan-board and titled "Plan board"', () => {
    expect([widget.name, widget.title]).toEqual(['plan-board', 'Plan board']);
  });

  // SP4.3d2 Task 12: the planning round's topics; every topic optional (the variant reads one source, C66)
  it('reads strategy.car and plans.preview for the link\'s primary car, plans.prepared and situation.sessionPhaseRace, all optional', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      plan: 'strategy.car',
      preview: 'plans.preview',
      prepared: 'plans.prepared',
      phase: 'situation.sessionPhaseRace',
    });
    const link = { group: 1, feedId: feedId('f'), primary: carId(3), compare: [carId(4)], window: { kind: 'live' as const } };
    expect(widget.data.plan.params?.({ link, options: {} })).toEqual({ carId: carId(3) });
    expect(widget.data.preview.params?.({ link, options: {} })).toEqual({ carId: carId(3) });
    for (const [key, d] of Object.entries(widget.data)) expect('optional' in d && d.optional, key).toBe(true);
  });

  it('declares the panel option source: auto (default), live or planning', () => {
    expect(widget.options.source).toMatchObject({ kind: 'choice', default: 'auto', choices: ['auto', 'live', 'planning'] });
  });

  it('invokes the six planning commands, nothing else (C72, C74)', () => {
    expect([...widget.commands].sort()).toEqual(
      ['plan.accept', 'plans.prepare.accept', 'plans.prepare.activate', 'plans.prepare.remove', 'plans.prepare.save', 'plans.race.set'],
    );
  });

  it('has the mockup sizes: compact 37×7, full 82×13', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 37, minRows: 7 }, full: { minCols: 82, minRows: 13 } });
  });

  it('sends plan.save, plan.activate and plan.remove, nothing else (C74)', () => {
    expect([...widget.actions].sort()).toEqual(['plan.activate', 'plan.remove', 'plan.save']);
  });
});

describe('plan-board gallery', () => {
  it('a case per mockup state: race (the baseline), the three-slot compact board, `= A`, cold start, computing, notApplicable, the grid prefill, the planning round\'s four', () => {
    const names = Object.keys(cases);
    expect(names[0]).toBe('race');
    expect(names).toEqual([
      'race', 'threeSlots', 'sameAsSlot', 'coldStart', 'computing', 'notApplicable',
      'gridPrefill', 'planningRound', 'planningComputing', 'planningNoLaps', 'planningNotApplicable',
    ]);
    const race = cases.race.plan.value;
    expect(race.known && race.value.rows.filter((r) => r.slot !== null).map((r) => r.slot).sort()).toEqual([...PLAN_SLOTS].sort());
    expect(race.known && race.value.rows.filter((r) => r.committed).map((r) => r.slot)).toEqual(['A']);
    expect(race.known && Object.keys(race.value.bestPerStops)).toEqual(['0', '1', '2', '3']);
    const three = cases.threeSlots.plan.value;
    expect(three.known && three.value.rows.filter((r) => r.slot !== null).map((r) => r.slot).sort()).toEqual(['A', 'B', 'G1']);
    const same = cases.sameAsSlot.plan.value;
    expect(same.known && same.value.rows[same.value.bestPerStops[1]!]!.slot).toBe('A');
    const cold = cases.coldStart.plan.value;
    expect(cold.known && cold.value.scenarios).toBe(400);
    expect('plan' in cases.computing).toBe(false);
    expect(cases.notApplicable.plan.value).toEqual({ known: false, reason: 'notApplicable' });
    // plans are stop lists (SP4.3d spec §5.1); in the race no plan carries a start compound
    for (const c of [cases.race, cases.threeSlots, cases.sameAsSlot, cases.coldStart]) {
      if (!c.plan.value.known) continue;
      for (const r of c.plan.value.value.rows) expect(Object.keys(r.policy)).toEqual(['stops']);
    }
  });

  // SP4.3d2 Task 12: the planning round's states (plan-board.html "Planning round", "computing", the round's
  // notApplicable) and the race's grid prefill; the planning cases drawn with `source: planning`
  it('the planning round\'s cases: the round, computing, no laps entered, notApplicable; the live grid prefill', () => {
    expect(caseOptions).toEqual({
      planningRound: { source: 'planning' },
      planningComputing: { source: 'planning' },
      planningNoLaps: { source: 'planning' },
      planningNotApplicable: { source: 'planning' },
    });
    const r = cases.planningRound;
    expect(r.prepared.open).toBe(true);
    const preview = r.preview.value;
    expect(preview.known && preview.value.planning).toMatchObject({ laps: 44, gridPlace: { known: true, value: 8 }, rainPct: { known: true, value: 10 } });
    expect(preview.known && Object.keys(preview.value.prefill).sort()).toEqual(['A', 'B']);
    expect(preview.known && preview.value.rows.filter((x) => x.slot !== null).map((x) => x.slot)).toEqual(['G1']);
    // in the planning round every plan carries its start compound (SP4.3d spec §7.2)
    for (const row of preview.known ? preview.value.rows : []) expect(row.policy.startCompound).toBeDefined();
    expect(r.prepared.open && r.prepared.race.laps).toBe(44);
    expect(cases.planningComputing.prepared.open && cases.planningComputing.prepared.running).toBe(true);
    expect('preview' in cases.planningComputing).toBe(false);
    expect(cases.planningNoLaps.prepared.open && cases.planningNoLaps.prepared.race.laps).toBeNull();
    expect('preview' in cases.planningNoLaps).toBe(false);
    expect(cases.planningNotApplicable.prepared).toEqual({ open: false, saved: [] });
    const grid = cases.gridPrefill.plan.value;
    expect(grid.known && Object.keys(grid.value.prefill).sort()).toEqual(['A', 'B']);
    expect(grid.known && grid.value.rows.every((x) => x.slot === null)).toBe(true);
    expect(cases.gridPrefill.phase.open[0]?.kind).toBe('grid');
  });

  it('fits at both mode minimums', () => {
    for (const [mode, s] of Object.entries(widget.sizes)) {
      expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    }
  });
});
