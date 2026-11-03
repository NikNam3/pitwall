// The compound-rule sub-machine (contract C9, C14, C15, C17, C18, C26): per car, race only; `required` until the race's
// first lap on intermediates or wets waives it. Transition rows: compound-rule.transitions.ts. Segment:
// compound-rule.segments.test.ts.
import { describe, expect, it } from 'vitest';
import { compoundRuleSpans, type OpenSpan, type Span } from '@pitwall/domain';
import machine from '../../../src/situations/compound-rule/machine.ts';
import { all } from '../session-phase/inputs.ts';
import { FRAME_MS, inputs, type MachineInputBuilder } from '../../support/transition-table.ts';
import { race, runs } from './compound-rule.transitions.ts';

type Run = { open: Array<OpenSpan | undefined>; closed: Array<Array<Omit<Span, 'endFrame'>>> };

/** Steps the machine through the frames: car `index`'s open span after each, and the spans each frame closed for it. */
const run = (builder: MachineInputBuilder, index = 0): Run => {
  let open = machine.init();
  const result: Run = { open: [], closed: [] };
  for (const input of builder.build()) {
    const step = machine.step(open, input);
    open = step.open;
    result.open.push(machine.openSpans(open).find((s) => s.carId === index));
    result.closed.push(step.closed.filter((s) => s.carId === index));
  }
  return result;
};

describe('compound-rule: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine compound-rule, its spans the car-scoped declaration in domain, applies to the race phase only', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual(['compound-rule', compoundRuleSpans, ['race']]);
    expect(machine.spans.scope).toBe('car');
  });
  it('reads the tyres values (the visual compound), no signal and no upstream sub-machine', () => {
    expect(machine.inputs.values).toEqual(expect.arrayContaining(['tyres']));
    expect([machine.inputs.signals, machine.inputs.upstream]).toEqual([[], []]);
  });
});

describe('compound-rule: every car slot has a span from the first frame on', () => {
  it('opens one span per car slot on the first frame, joined, on frame number 1: required on a dry compound', () => {
    const [first] = inputs().frame(race('hard')).build();
    const spans = machine.openSpans(machine.step(machine.init(), first!).open);
    expect(spans.map((s) => s.carId)).toEqual(first!.signals.cars.map((_, i) => i));
    expect(spans[0]).toMatchObject({ machine: 'compound-rule', kind: 'required', id: 0, start: 0, startFrame: 1, joinedAt: true, confirmed: true });
  });
});

describe('compound-rule: the first lap on intermediates or wets waives the rule', () => {
  it.each(['inter', 'wet'] as const)('a car on a dry compound turns %s on lap 3: required closes and waived opens on that frame (C26)', (wet) => {
    const r = run(inputs().frames(3, race('medium', 2)).frame(race(wet, 3)).frames(2));
    expect(r.open.slice(0, 3).map((s) => [s?.id, s?.kind])).toEqual(Array(3).fill([0, 'required']));
    expect(r.open[3]).toMatchObject({ kind: 'waived', id: 1, start: 3 * FRAME_MS, startFrame: 4, confirmed: true });
    expect(r.open[3]!.joinedAt).toBeUndefined();
    expect(r.closed[3]).toMatchObject([{ kind: 'required', id: 0, start: 0, end: 3 * FRAME_MS, startFrame: 1 }]);
    expect(r.open[5]).toEqual(r.open[3]);
  });
  it('a change between dry compounds changes nothing: one required span', () => {
    const r = run(inputs().frames(2, race('soft', 1)).frames(2, race('hard', 2)).frames(2, race('medium', 3)));
    expect(r.open.map((s) => [s?.id, s?.kind])).toEqual(Array(6).fill([0, 'required']));
    expect(r.closed.flat()).toEqual([]);
  });
  it('a waived rule stays waived: a later stop to a dry compound opens nothing', () => {
    const r = run(inputs().frames(2, race('medium', 2)).frames(2, race('inter', 3)).frames(3, race('hard', 6)));
    expect(r.open.slice(2).map((s) => [s?.id, s?.kind])).toEqual(Array(5).fill([1, 'waived']));
    expect(r.closed.flat()).toHaveLength(1);
  });
  it('a car that starts on wets is waived from the first frame (joined) and stays so on a change to intermediates', () => {
    const r = run(inputs().frames(2, race('wet')).frames(2, race('inter', 5)));
    expect(r.open[0]).toMatchObject({ kind: 'waived', id: 0, startFrame: 1, joinedAt: true });
    for (const s of r.open) expect(s).toEqual(r.open[0]);
  });
  it('the rule is the car’s own: car 0 turning wet leaves car 1 required', () => {
    const builder = inputs().frames(2, all(race('medium', 2), runs(1, 'hard', 2))).frame(all(race('wet', 3), runs(1, 'hard', 3)));
    expect(run(builder, 0).open.at(-1)).toMatchObject({ kind: 'waived' });
    const other = run(builder, 1);
    expect(other.open.map((s) => [s?.id, s?.kind])).toEqual(Array(3).fill([0, 'required']));
    expect(other.closed.flat()).toEqual([]);
  });
});
