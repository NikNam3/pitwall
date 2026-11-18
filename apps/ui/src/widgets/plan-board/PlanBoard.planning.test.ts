// @vitest-environment jsdom
// The plan board in the planning round (SP4.3d2 Task 12; SP4.3d spec §6.2, §7.1; mockup
// docs/design/2026-11-16-sp4.3d/plan-board.html "Planning round", plan-workbook.html; C65, C66, C68, C72–C74). Contract
// assumed of `PlanBoard.svelte` on top of PlanBoard.test.ts (data `plan`, `preview`, `prepared`, `phase`, all optional;
// option `source: auto | live | planning`, default `auto`):
//  - the variant: `live` draws `plan` (strategy.car), `planning` draws `preview` (plans.preview); `auto` is the
//    presentation table's (`presentation.ts` `variantOf`): planning while `prepared.open`, live otherwise;
//  - planning variant, full: the race inputs line `[data-testid="inputs"]` (mockup `planInputs`): `GRID` and the grid
//    place (`P8`, the preview's `planning.gridPlace`), `LAPS` and the laps field `<input data-testid="laps">` (its value
//    the round's race laps `prepared.race.laps`, the bridge's suggestion or entered; `''` while `null`, SP4.3e R16),
//    `RAIN` and the rain chance (`10%`), `N` and the scenarios (`1200`); then the header with `START` and the slot and
//    DP lines as in the race; each slot line's start compound letter in `[data-testid="start-<slot>"]`;
//  - LAPS (C73): typing is window-local; committing the field (its `change`) invokes the command `plans.race.set`
//    once with `{ feedId: link.feedId, race: { laps: <the number>, sets: <the round's sets> } }` (SP4.3e Task 7b); a rejected value (`{ ok: false, message }`) marks the
//    field with the warning role (`data-role="warning"`) and the bridge's message as its hover;
//  - a prefilled slot (`preview.prefill`, A and B, not yet saved): its line `row-<slot>` (the slot without `●`), its
//    plan's STOPS and the E[POS] of the preview's row with that plan, dim, a hover naming the prefill, and
//    `<button data-testid="accept-<slot>">accept</button>`, which invokes `plans.prepare.accept` with
//    `{ feedId, carId: link.primary, slot, policy: the prefill's policy }`; a saved slot (G1) has no accept;
//  - an empty game slot (G2) has its entry `[data-testid="entry-G2"]`, a window-local draft (C73): the start compound
//    `<select data-testid="entry-G2-start">` (option values the `NoiseCompound` names), `<button
//    data-testid="entry-G2-add">` (`+ stop`), per stop `<input data-testid="entry-G2-lap-<i>">` and `<select
//    data-testid="entry-G2-compound-<i>">`, `<button data-testid="entry-G2-save">` (`save to G2`); nothing is invoked
//    until save, which invokes `plans.prepare.save` with `{ feedId, carId, slot: 'G2', policy: { startCompound, stops } }`;
//  - computing: while `prepared.running`, `[data-testid="computing"]`; none otherwise;
//  - no laps known (`prepared.race.laps` null, no preview): the inputs line with the empty laps field, no placeholder;
//    no slot or DP line;
//  - the live variant on the grid with a prefill (`plan.prefill`, the race's strategy job, Task 9): the prefilled lines
//    with `accept-<slot>`, which invokes `plan.accept` with `{ feedId, carId, slot, policy }`.
// Every control invokes a command by id through the panel (`kit/commands.ts` `getWidgetCommands().invoke`, C72), only
// ids the declaration lists (C74); no planning control sends a uiAction itself. The panel's commands are stubbed here
// (vi.mock of kit/commands.ts, throwing on an undeclared id as the panel does in dev); the panel's `send` is
// test/kit/ActionsHarness.svelte's.
// Needs the planning variant of `PlanBoard.svelte` and `presentation.ts` `variantOf` (implementation): fails until then.
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import type { ResolvedLink } from '../../kit/types.ts';
import { formatExpectedPlaceSe } from '../../kit/values/format.ts';
import { CLOSED, KUH, LAPS, PLANNING, PREFILL, cases, round } from './fixtures.ts';
import PlanBoard from './PlanBoard.svelte';
import { widget } from './widget.ts';

const mocks = vi.hoisted(() => ({ invoke: vi.fn<(id: string, args: unknown) => Promise<ActionOutcome>>() }));
vi.mock('../../kit/commands.ts', () => ({
  getWidgetCommands: () => ({ invoke: mocks.invoke }),
  setWidgetCommands: () => undefined,
}));

let respond: () => Promise<ActionOutcome> = () => Promise.resolve({ ok: true });
beforeEach(() => {
  respond = () => Promise.resolve({ ok: true });
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((id: string) => {
    if (!(widget.commands as readonly string[]).includes(id)) throw new Error(`command "${id}" is not declared by the widget (C74)`);
    return respond();
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const SIZE = { mode: 'full', cols: 88, rows: 13, px: { width: 88 * 8, height: 13 * 19.6 }, dpr: 1 } as const;
const LINK: ResolvedLink = { group: 1, feedId: feedId('20778'), primary: KUH, compare: [], window: { kind: 'live' } };

type Data = Record<string, unknown>;
type Source = 'auto' | 'live' | 'planning';

function mount(data: Data, source: Source = 'planning') {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const sent: UiAction[] = [];
  const props = (d: Data, s: Source) => ({ data: d, options: { source: s }, size: SIZE, link: LINK });
  const { container, rerender } = render(ActionsHarness, {
    send: (action: UiAction) => {
      sent.push(action);
      return Promise.resolve({ ok: true });
    },
    actions: widget.actions,
    component: PlanBoard as unknown as Component<Record<string, unknown>>,
    widgetProps: props(data, source),
  });
  return { container, sent, update: (d: Data, s: Source = source) => rerender({ widgetProps: props(d, s) }) };
}

const find = (c: Element, id: string): Element | null => c.querySelector(`[data-testid="${id}"]`);
function get(c: Element, id: string): HTMLElement {
  const el = find(c, id);
  if (el === null) throw new Error(`no ${id}`);
  return el as HTMLElement;
}
const all = (c: Element, prefix: string): Element[] => [...c.querySelectorAll(`[data-testid^="${prefix}"]`)];
const ids = (c: Element, prefix: string): string[] => all(c, prefix).map((e) => e.getAttribute('data-testid') ?? '');
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const hovers = (el: Element): string[] => [el.closest('[title]'), ...el.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));
/** Sets a field's value and commits it (input then change). */
async function type(el: HTMLElement, value: string): Promise<void> {
  (el as HTMLInputElement).value = value;
  await fireEvent.input(el);
  await fireEvent.change(el);
}
/** The preview row holding `policy` (the prefill's cells come from it). */
const rowOf = (policy: object) => PLANNING.rows.find((r) => JSON.stringify(r.policy) === JSON.stringify(policy))!;

describe('plan board: the planning round per the mockup', () => {
  it('planning round: the race inputs line, START, A and B prefilled with accept, G1 entered, G2\'s entry, the DP lines', () => {
    const { container: c, sent } = mount(cases.planningRound);
    const inputs = get(c, 'inputs');
    for (const part of ['GRID', 'P8', 'LAPS', 'RAIN', '10%', 'N', '1200']) expect(textOf(inputs), part).toContain(part);
    const laps = get(inputs, 'laps') as HTMLInputElement;
    // the round's race laps (`race.laps`); no placeholder (SP4.3e R16: no suggestion field of its own)
    expect(laps.value).toBe(String(LAPS));
    expect(laps.placeholder).toBe('');
    expect(textOf(c)).toContain('START');
    // the slot lines in slot order: the prefilled A and B, the entered G1; G2 is its entry
    expect(ids(c, 'row-')).toEqual(['row-A', 'row-B', 'row-G1']);
    expect(ids(c, 'dp-')).toEqual(['dp-0', 'dp-1', 'dp-2', 'dp-3']);
    expect(find(c, 'entry-G2')).not.toBeNull();
    // the start compounds (gen.mjs START: A M, B S, G1 M)
    expect([textOf(get(c, 'start-A')), textOf(get(c, 'start-B')), textOf(get(c, 'start-G1'))]).toEqual(['M', 'S', 'M']);
    // a prefilled line: its plan, the E[POS] of the preview's row with that plan, dim with the prefill's hover, accept
    const a = get(c, 'row-A');
    expect(textOf(a)).toContain('L22 H');
    expect(textOf(a)).not.toContain('A●');
    expect(textOf(a)).toContain(formatExpectedPlaceSe(rowOf(PREFILL.A).ePos, rowOf(PREFILL.A).se));
    expect(hovers(a).join(' ')).toMatch(/prefill/);
    expect(textOf(get(c, 'accept-A'))).toBe('accept');
    expect(textOf(get(c, 'row-B'))).toContain('L12 H · L30 M');
    expect(find(c, 'accept-B')).not.toBeNull();
    // the entered G1 has no accept
    expect(textOf(get(c, 'row-G1'))).toContain('L19 H');
    expect(find(c, 'accept-G1')).toBeNull();
    expect(find(c, 'computing')).toBeNull();
    expect(sent).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('computing: the inputs line and the computing mark while the job runs', () => {
    const { container: c } = mount(cases.planningComputing);
    expect(find(c, 'inputs')).not.toBeNull();
    expect(find(c, 'computing')).not.toBeNull();
    // with a previous result the lines stay; the mark goes once the job is done
    const { container: c2 } = mount({ ...cases.planningRound, prepared: round({ running: true }) });
    expect(find(c2, 'computing')).not.toBeNull();
    expect(ids(c2, 'row-')).toEqual(['row-A', 'row-B', 'row-G1']);
  });

  it('no laps known: the empty laps field, no lines', () => {
    const { container: c } = mount(cases.planningNoLaps);
    const laps = get(get(c, 'inputs'), 'laps') as HTMLInputElement;
    expect(laps.value).toBe('');
    expect(laps.placeholder).toBe('');
    expect(all(c, 'row-')).toHaveLength(0);
    expect(all(c, 'dp-')).toHaveLength(0);
    expect(find(c, 'computing')).toBeNull();
  });

  it('notApplicable: source planning outside the round draws the kit\'s mark, no inputs line', () => {
    const { container: c } = mount(cases.planningNotApplicable);
    expect(find(c, 'inputs')).toBeNull();
    expect(all(c, 'row-')).toHaveLength(0);
  });
});

describe('plan board: the source', () => {
  it('auto picks planning while the round is open and live after', async () => {
    const { container: c, update } = mount(cases.planningRound, 'auto');
    expect(find(c, 'inputs')).not.toBeNull();
    expect(ids(c, 'row-')).toEqual(['row-A', 'row-B', 'row-G1']);
    // the round closes (the race loads): the race's board, its slots A to G2 (C among them)
    await update({ ...cases.planningRound, prepared: CLOSED });
    expect(find(c, 'inputs')).toBeNull();
    expect(ids(c, 'row-')).toEqual(['row-A', 'row-B', 'row-C', 'row-G1', 'row-G2']);
    expect(textOf(get(c, 'row-A'))).toContain('A●');
  });

  it('live ignores an open round; auto without plans.prepared is live', () => {
    const { container: c } = mount(cases.planningRound, 'live');
    expect(find(c, 'inputs')).toBeNull();
    expect(ids(c, 'row-')).toContain('row-C');
    cleanup();
    const { container: c2 } = mount(cases.race, 'auto');
    expect(find(c2, 'inputs')).toBeNull();
    expect(ids(c2, 'row-')).toContain('row-C');
  });
});

describe('plan board: the planning controls invoke commands (C72–C74)', () => {
  it('accept invokes plans.prepare.accept with the prefill\'s policy and slot', async () => {
    const { container: c, sent } = mount(cases.planningRound);
    await fireEvent.click(get(c, 'accept-B'));
    expect(mocks.invoke.mock.calls).toEqual([['plans.prepare.accept', { feedId: LINK.feedId, carId: LINK.primary, slot: 'B', policy: PREFILL.B }]]);
    expect(sent).toEqual([]);
  });

  it('a draft invokes nothing until save', async () => {
    const { container: c, sent } = mount(cases.planningRound);
    const entry = get(c, 'entry-G2');
    expect(textOf(get(entry, 'entry-G2-save'))).toBe('save to G2');
    await type(get(entry, 'entry-G2-start'), 'soft');
    await fireEvent.click(get(entry, 'entry-G2-add'));
    await type(get(c, 'entry-G2-lap-0'), '17');
    await type(get(c, 'entry-G2-compound-0'), 'hard');
    await fireEvent.click(get(c, 'entry-G2-add'));
    await type(get(c, 'entry-G2-lap-1'), '31');
    await type(get(c, 'entry-G2-compound-1'), 'medium');
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    await fireEvent.click(get(c, 'entry-G2-save'));
    const policy = { startCompound: 'soft', stops: [{ lap: 17, compound: 'hard' }, { lap: 31, compound: 'medium' }] };
    expect(mocks.invoke.mock.calls).toEqual([['plans.prepare.save', { feedId: LINK.feedId, carId: LINK.primary, slot: 'G2', policy }]]);
    expect(sent).toEqual([]);
  });

  it('LAPS invokes plans.race.set once with the number and the round\'s sets', async () => {
    const { container: c, sent } = mount(cases.planningNoLaps);
    const laps = get(c, 'laps') as HTMLInputElement;
    laps.value = '5';
    await fireEvent.input(laps);
    laps.value = '52';
    await fireEvent.input(laps);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await fireEvent.change(laps);
    expect(mocks.invoke.mock.calls).toEqual([['plans.race.set', { feedId: LINK.feedId, race: { laps: 52, sets: 'carried', conditions: { kind: 'imported' } } }]]);
    expect(sent).toEqual([]);
  });

  it('LAPS rejected: the field amber with the bridge\'s message on hover', async () => {
    const message = 'laps must be a whole number from 1 to 100';
    respond = () => Promise.resolve({ ok: false, reason: 'invalid', message });
    const { container: c } = mount(cases.planningNoLaps);
    await type(get(c, 'laps'), '0');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(get(c, 'laps').getAttribute('data-role')).toBe('warning'));
    expect(hovers(get(c, 'laps'))).toContain(message);
  });

  it('the live grid prefill invokes plan.accept', async () => {
    const { container: c, sent } = mount(cases.gridPrefill, 'auto');
    expect(find(c, 'inputs')).toBeNull();
    expect(ids(c, 'row-')).toEqual(['row-A', 'row-B']);
    expect(hovers(get(c, 'row-A')).join(' ')).toMatch(/prefill/);
    await fireEvent.click(get(c, 'accept-A'));
    expect(mocks.invoke.mock.calls).toEqual([['plan.accept', { feedId: LINK.feedId, carId: LINK.primary, slot: 'A', policy: PREFILL.A }]]);
    expect(sent).toEqual([]);
  });
});
