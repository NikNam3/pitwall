// @vitest-environment jsdom
// The plan board as it renders (SP4.3d spec §6.1, §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html, full
// 82×13, compact 37×7; C65, C66, C68, C72–C74). Contract assumed of `PlanBoard.svelte` (props `WidgetProps<typeof widget>`,
// data `plan`, `phase`; option `source`), on top of `rows.ts` (`rows.test.ts`) and `presentation.ts`:
//  - full: one `[data-testid="row-<key>"]` per slot line (`row-A` … `row-G2`, `row-active`), then the DP line, then one
//    `[data-testid="dp-<stopCount>"]` per DP line; each line shows its label, STOPS, E[POS], ΔPOS, ΔTIME (`rows.ts`) and
//    one kit `DistStrip` of form `places` (`svg.dist-strip`); an infeasible line carries its reason as a hover
//    (`title`); a DP line ends in a `<button data-testid="to-slot-<n>">→ slot</button>`, or, when it equals a slot,
//    the text `= <slot>` in `[data-testid="same-<n>"]` (no button);
//  - `→ slot` opens a slot picker: one `<button data-testid="pick-<slot>">` per `PLAN_SLOTS` slot; a pick sends
//    `plan.save { feedId: link.feedId, carId: link.primary, slot, policy: the DP row's policy }` and closes the picker;
//    nothing is sent before the pick;
//  - a click on a slot line selects it (window-local, sends nothing; a second click clears) and shows the actions line
//    `[data-testid="actions"]`: `<button data-testid="activate">`, `<button data-testid="edit">`,
//    `<button data-testid="remove">` (`activate`, `edit`, `×`); the active line offers neither activate nor remove (the
//    bridge rejects removing the active slot). activate sends `plan.activate { feedId, carId, slot }`, remove sends
//    `plan.remove { feedId, carId, slot }`;
//  - edit opens the window-local draft `[data-testid="editor"]` (C73): per stop a lap field `<input
//    data-testid="edit-lap-<i>">` (the lap number), a compound `<select data-testid="edit-compound-<i>">` (option values
//    the `NoiseCompound` names) and `<button data-testid="edit-drop-<i>">`; `<button data-testid="edit-add">` (`+ stop`);
//    `<button data-testid="edit-save">` (`save to <slot>`), `<button data-testid="edit-save-as">` (`save as <slot>`, the
//    first `PLAN_SLOTS` slot without a row; absent when every slot is taken), `<button data-testid="edit-cancel">`.
//    Nothing is sent until a save: save sends `plan.save` for the edited slot (save as: for the free slot) with the
//    draft's policy; an accepted save closes the editor; cancel closes it and sends nothing;
//  - a rejected save (the panel's `send` resolves `{ ok: false, message }`, C73): the editor stays open with the draft,
//    and every field the draft changed against the slot's policy shows the warning role (`data-role="warning"`) with
//    the bridge's message as its hover; the other fields have no `data-role="warning"`;
//  - compact: the slot and DP lines only (`rows.ts` compact), no strip, no ΔTIME, no buttons;
//  - the presentation table: under a phase whose row hides the actions (`finished`), the lines stay and no button is drawn;
//  - option `source: planning` outside the planning round (`plans.prepared` closed, SP4.3d2 Task 12): the kit's
//    notApplicable mark with its reason on hover, no lines, full and compact; an unknown `plan.value` the same (the
//    planning round itself: PlanBoard.planning.test.ts); no `plan` (computing): nothing drawn (the panel frame shows its state).
// `send` comes from the panel (kit `getUiActions`); test/kit/ActionsHarness.svelte stands in for it with the widget's
// declared actions (C74), and the panel's resolved link is a non-default feed (the action carries `link.feedId`, R24).
// Needs `PlanBoard.svelte` (implementation): fails until it exists.
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import { carId, feedId, PLAN_SLOTS } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import type { ResolvedLink } from '../../kit/types.ts';
import { cases, COMPACT, phaseSpans, RACE } from './fixtures.ts';
import PlanBoard from './PlanBoard.svelte';
import { widget } from './widget.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const SIZES = { compact: { cols: 37, rows: 7 }, full: { cols: 82, rows: 13 } } as const;
const LINK: ResolvedLink = { group: 1, feedId: feedId('20778'), primary: carId(0), compare: [], window: { kind: 'live' } };

type Data = Partial<(typeof cases)[keyof typeof cases]>;
type Opts = { mode?: keyof typeof SIZES; source?: 'auto' | 'live' | 'planning'; respond?: () => Promise<ActionOutcome> };

function mount(data: Data, { mode = 'full', source = 'live', respond = () => Promise.resolve({ ok: true }) }: Opts = {}) {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const sent: UiAction[] = [];
  const size = SIZES[mode];
  const { container } = render(ActionsHarness, {
    send: (action: UiAction) => {
      sent.push(action);
      return respond();
    },
    actions: widget.actions,
    component: PlanBoard as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: { source }, size: { mode, ...size, px: { width: size.cols * 8, height: size.rows * 19.6 }, dpr: 1 }, link: LINK },
  });
  return { container, sent };
}

const find = (c: Element, id: string): Element | null => c.querySelector(`[data-testid="${id}"]`);
function get(c: Element, id: string): HTMLElement {
  const el = find(c, id);
  if (el === null) throw new Error(`no ${id}`);
  return el as HTMLElement;
}
const all = (c: Element, prefix: string): Element[] => [...c.querySelectorAll(`[data-testid^="${prefix}"]`)];
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** Every hover in an element: its own title, its titled ancestor's and its descendants'. */
const hovers = (el: Element): string[] => [el.closest('[title]'), ...el.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));
const policyOfSlot = (slot: string) => RACE.rows.find((r) => r.slot === slot)!.policy;
/** Types `value` into a field and commits it (input then change). */
async function type(el: HTMLElement, value: string): Promise<void> {
  (el as HTMLInputElement).value = value;
  await fireEvent.input(el);
  await fireEvent.change(el);
}

describe('plan board: rows and states per the mockup', () => {
  it('full: the five slots in slot order, A● first, then the DP\'s four picks, each with its cells and a places strip', () => {
    const { container: c } = mount(cases.race);
    expect(all(c, 'row-').map((e) => e.getAttribute('data-testid'))).toEqual(PLAN_SLOTS.map((s) => `row-${s}`));
    expect(all(c, 'dp-').map((e) => e.getAttribute('data-testid'))).toEqual(['dp-0', 'dp-1', 'dp-2', 'dp-3']);
    const a = textOf(get(c, 'row-A'));
    expect(a).toContain('A●');
    expect(a).toContain('L22 H');
    expect(a).toContain('7.94±.06');
    const b = textOf(get(c, 'row-B'));
    for (const cell of ['L18 H · L33 S', '7.56±.07', '+0.38', '−2.4']) expect(b).toContain(cell);
    const none = textOf(get(c, 'dp-0'));
    for (const cell of ['no stop', '9.81±.08', '−1.87', '+12.2']) expect(none).toContain(cell);
    for (const line of [...all(c, 'row-'), ...all(c, 'dp-')]) {
      expect(line.querySelectorAll('svg.dist-strip[data-form="places"]'), line.getAttribute('data-testid') ?? '').toHaveLength(1);
    }
  });

  it('the infeasible slot carries its reason on hover', () => {
    const { container: c } = mount(cases.race);
    expect(hovers(get(c, 'row-C')).join(' ')).toMatch(/stop lap/);
    expect(hovers(get(c, 'row-B')).join(' ')).not.toMatch(/stop lap/);
  });

  it('each DP line offers `→ slot`; a line equal to a slot shows `= A` and no button', () => {
    {
      const { container: c } = mount(cases.race);
      for (const n of [0, 1, 2, 3]) expect(textOf(get(c, `to-slot-${n}`)), String(n)).toBe('→ slot');
      expect(all(c, 'same-')).toHaveLength(0);
      cleanup();
    }
    const { container: c } = mount(cases.sameAsSlot);
    expect(textOf(get(c, 'same-1'))).toBe('= A');
    expect(get(c, 'dp-1').querySelector('button')).toBeNull();
    for (const n of [0, 2, 3]) expect(find(c, `to-slot-${n}`), String(n)).not.toBeNull();
  });

  it('compact: A●, B, G1 and the DP\'s 1- and 2-stop; no strip, no ΔTIME, no buttons', () => {
    const { container: c } = mount(cases.race, { mode: 'compact' });
    expect(all(c, 'row-').map((e) => e.getAttribute('data-testid'))).toEqual(['row-A', 'row-B', 'row-G1']);
    expect(all(c, 'dp-').map((e) => e.getAttribute('data-testid'))).toEqual(['dp-1', 'dp-2']);
    expect(c.querySelectorAll('svg.dist-strip')).toHaveLength(0);
    expect(c.querySelectorAll('button')).toHaveLength(0);
    expect(textOf(c)).not.toContain('ΔTIME');
    expect(textOf(get(c, 'row-B'))).toContain('+0.38');
    expect(textOf(get(c, 'row-B'))).not.toContain('−2.4');
  });

  it('cold start: the wider SE', () => {
    const { container: c } = mount(cases.coldStart);
    expect(textOf(get(c, 'row-A'))).toContain('7.94±.18');
    expect(textOf(get(c, 'dp-1'))).toContain('7.86±.18');
  });

  // SP4.3d2 Task 12: `source: planning` renders the planning round (PlanBoard.planning.test.ts); outside the round it
  // is notApplicable, whatever the live data
  it('notApplicable and planning outside the round: the kit\'s mark with its reason, no lines; computing: nothing drawn', () => {
    for (const mode of ['full', 'compact'] as const) {
      for (const [data, source] of [[cases.notApplicable, 'live'], [cases.planningNotApplicable, 'planning']] as const) {
        const { container: c } = mount(data, { mode, source });
        expect(textOf(c), `${mode} ${source}`).toBe(unknownMark.notApplicable);
        expect(hovers(c.querySelector('[title]') ?? c), `${mode} ${source}`).toContain(unknownReason.notApplicable);
        expect(all(c, 'row-')).toHaveLength(0);
        cleanup();
      }
    }
    const { container: c } = mount(cases.computing);
    expect(all(c, 'row-')).toHaveLength(0);
    expect(textOf(c)).toBe('');
  });

  it('presentation table: once finished the lines stay and no button is drawn', async () => {
    const { container: c, sent } = mount({ ...cases.race, phase: phaseSpans('finished') });
    expect(all(c, 'row-')).toHaveLength(PLAN_SLOTS.length);
    expect(all(c, 'dp-')).toHaveLength(4);
    expect(c.querySelectorAll('button')).toHaveLength(0);
    await fireEvent.click(get(c, 'row-B'));
    expect(c.querySelectorAll('button')).toHaveLength(0);
    expect(sent).toEqual([]);
  });
});

describe('plan board: actions (C72–C74)', () => {
  it('`→ slot` sends plan.save with the DP row\'s policy to the picked slot; nothing before the pick', async () => {
    const { container: c, sent } = mount(cases.race);
    await fireEvent.click(get(c, 'to-slot-2'));
    expect(sent).toEqual([]);
    expect(all(c, 'pick-').map((e) => e.getAttribute('data-testid'))).toEqual(PLAN_SLOTS.map((s) => `pick-${s}`));
    await fireEvent.click(get(c, 'pick-C'));
    const policy = RACE.rows[RACE.bestPerStops[2]!]!.policy;
    expect(sent).toEqual([{ kind: 'plan.save', feedId: LINK.feedId, carId: LINK.primary, slot: 'C', policy }]);
    expect(all(c, 'pick-')).toHaveLength(0);
  });

  it('a click on a slot selects it (sends nothing); activate sends plan.activate, × sends plan.remove', async () => {
    const { container: c, sent } = mount(cases.race);
    expect(find(c, 'actions')).toBeNull();
    await fireEvent.click(get(c, 'row-B'));
    expect(sent).toEqual([]);
    const line = get(c, 'actions');
    expect(textOf(line)).toContain('B');
    expect(textOf(get(c, 'activate'))).toBe('activate');
    expect(textOf(get(c, 'edit'))).toBe('edit');
    expect(textOf(get(c, 'remove'))).toBe('×');
    await fireEvent.click(get(c, 'activate'));
    expect(sent).toEqual([{ kind: 'plan.activate', feedId: LINK.feedId, carId: LINK.primary, slot: 'B' }]);
    await fireEvent.click(get(c, 'remove'));
    expect(sent[1]).toEqual({ kind: 'plan.remove', feedId: LINK.feedId, carId: LINK.primary, slot: 'B' });
    expect(sent).toHaveLength(2);
  });

  it('the active slot offers edit, neither activate nor remove; a second click clears the selection', async () => {
    const { container: c } = mount(cases.race);
    await fireEvent.click(get(c, 'row-A'));
    expect(find(c, 'edit')).not.toBeNull();
    expect(find(c, 'activate')).toBeNull();
    expect(find(c, 'remove')).toBeNull();
    await fireEvent.click(get(c, 'row-A'));
    expect(find(c, 'actions')).toBeNull();
  });

  it('an edit sends nothing until save; save sends plan.save for the slot with the draft\'s policy and closes the draft', async () => {
    const { container: c, sent } = mount(cases.threeSlots);
    await fireEvent.click(get(c, 'row-B'));
    await fireEvent.click(get(c, 'edit'));
    const editor = get(c, 'editor');
    expect((get(editor, 'edit-lap-0') as HTMLInputElement).value).toBe('18');
    expect((get(editor, 'edit-compound-0') as HTMLSelectElement).value).toBe('hard');
    expect((get(editor, 'edit-lap-1') as HTMLInputElement).value).toBe('33');
    expect((get(editor, 'edit-compound-1') as HTMLSelectElement).value).toBe('soft');
    expect(textOf(get(editor, 'edit-add'))).toBe('+ stop');
    expect(textOf(get(editor, 'edit-save'))).toBe('save to B');
    expect(textOf(get(editor, 'edit-save-as'))).toBe('save as C');
    await type(get(editor, 'edit-lap-0'), '17');
    await type(get(editor, 'edit-compound-1'), 'medium');
    expect(sent).toEqual([]);
    await fireEvent.click(get(editor, 'edit-save'));
    const policy = { ...COMPACT.rows.find((r) => r.slot === 'B')!.policy, stops: [{ lap: 17, compound: 'hard' }, { lap: 33, compound: 'medium' }] };
    expect(sent).toEqual([{ kind: 'plan.save', feedId: LINK.feedId, carId: LINK.primary, slot: 'B', policy }]);
    await vi.waitFor(() => expect(find(c, 'editor')).toBeNull());
  });

  it('save as sends plan.save for the first free slot and keeps the edited one; a dropped stop is gone from the policy', async () => {
    const { container: c, sent } = mount(cases.threeSlots);
    await fireEvent.click(get(c, 'row-B'));
    await fireEvent.click(get(c, 'edit'));
    await fireEvent.click(get(c, 'edit-drop-1'));
    expect(find(c, 'edit-lap-1')).toBeNull();
    expect(sent).toEqual([]);
    await fireEvent.click(get(c, 'edit-save-as'));
    expect(sent).toEqual([{ kind: 'plan.save', feedId: LINK.feedId, carId: LINK.primary, slot: 'C', policy: { stops: [{ lap: 18, compound: 'hard' }] } }]);
  });

  it('every slot taken: no save as', async () => {
    const { container: c } = mount(cases.race);
    await fireEvent.click(get(c, 'row-B'));
    await fireEvent.click(get(c, 'edit'));
    expect(find(c, 'edit-save')).not.toBeNull();
    expect(find(c, 'edit-save-as')).toBeNull();
  });

  it('cancel closes the draft and sends nothing', async () => {
    const { container: c, sent } = mount(cases.threeSlots);
    await fireEvent.click(get(c, 'row-B'));
    await fireEvent.click(get(c, 'edit'));
    await type(get(c, 'edit-lap-1'), '30');
    await fireEvent.click(get(c, 'edit-cancel'));
    expect(find(c, 'editor')).toBeNull();
    expect(sent).toEqual([]);
    // the board's rows are unchanged: the draft was never stored
    expect(textOf(get(c, 'row-B'))).toContain('L18 H · L33 S');
  });

  it('a rejected value: the draft stays, the changed field amber with the bridge\'s reason on hover', async () => {
    const message = "lap 48 is past the race's 44 laps";
    const { container: c, sent } = mount(cases.threeSlots, { respond: () => Promise.resolve({ ok: false, reason: 'invalid', message }) });
    await fireEvent.click(get(c, 'row-B'));
    await fireEvent.click(get(c, 'edit'));
    await type(get(c, 'edit-lap-1'), '48');
    await fireEvent.click(get(c, 'edit-save'));
    expect(sent).toEqual([{ kind: 'plan.save', feedId: LINK.feedId, carId: LINK.primary, slot: 'B', policy: { stops: [{ lap: 18, compound: 'hard' }, { lap: 48, compound: 'soft' }] } }]);
    await vi.waitFor(() => expect(get(c, 'edit-lap-1').getAttribute('data-role')).toBe('warning'));
    expect(hovers(get(c, 'edit-lap-1'))).toContain(message);
    expect((get(c, 'edit-lap-1') as HTMLInputElement).value).toBe('48');
    for (const id of ['edit-lap-0', 'edit-compound-0', 'edit-compound-1']) expect(get(c, id).getAttribute('data-role'), id).not.toBe('warning');
    expect(find(c, 'editor')).not.toBeNull();
    // never stored: the board's row still shows the saved plan
    expect(textOf(get(c, 'row-B'))).toContain('L18 H · L33 S');
    expect(policyOfSlot('B')).toEqual({ stops: [{ lap: 18, compound: 'hard' }, { lap: 33, compound: 'soft' }] });
  });
});
