// @vitest-environment jsdom
// The plan board's race conditions in the planning round (SP4.3f Task 7; spec §4.3, §4.4; mockup
// docs/design/2026-11-18-sp4.3f/plan-board-conditions.html, gen.mjs `CT`, `inputsLine`, `conditionLines`; C3, C65,
// C66, C68, C72–C74). Contract assumed of `PlanBoard.svelte` on top of PlanBoard.planning.test.ts:
//  - full planning variant: the inputs line `[data-testid="inputs"]` holds, after `RAIN`, `<button data-testid="rain">`
//    with the rain chance (the preview's `planning.rainPct`, `45%`) and `▸`; with the round's forecast rows unknown it
//    shows the kit's missing mark (`…`, C3), never a number; after it the source label
//    `[data-testid="conditions-source"]`: `imported · Q 17 Nov` (the round's `forecast.source.startedAt`) while no row is
//    overridden, `edited` once one is;
//  - a click on `rain` opens the conditions editor `[data-testid="conditions"]` in place of the plan rows (no `row-*`,
//    no `dp-*` while open; window-local, C73): a header line (`+MIN`, `WEATHER`, `RAIN`) with
//    `<button data-testid="cond-reset">reset</button>` and `<button data-testid="cond-done">done</button>`; per row
//    `[data-testid="cond-<i>"]` with its offset `[data-testid="cond-<i>-at"]` (`+0`, `+30`: minutes through
//    kit/values/format.ts, C68), `<select data-testid="cond-<i>-weather">` (option values the `Weather` names) and
//    `<input data-testid="cond-<i>-rain">` (the rain chance, whole %); an overridden row carries `data-role="text"` (bright)
//    and the mark `edited`, an imported row `data-role="textDim"` (presentation.ts / emphasis.ts, C66, C68); done closes it;
//  - committing a field (its `change`; typing is window-local) invokes the command `plans.race.set` once with
//    `{ feedId: link.feedId, race: { laps: <the round's>, sets: <the round's>, conditions: <conditions.ts enteredWith> } }`;
//    reset invokes it with `conditions: { kind: 'imported' }`; a rejected value (`{ ok: false, message }`) marks the
//    field `data-role="warning"` with the bridge's message as its hover, as LAPS does (C73);
//  - no race samples (rows `unknown('notReceived')`): the editor offers one row to enter at `+0` (its rain field empty,
//    never `0`) and `<button data-testid="cond-add">+ row</button>`;
//  - compact: no `rain` button, no editor (mockup: compact shows the rain and its source only).
// Every control invokes a command by id through the panel (C72, C74); the panel's commands are stubbed as in
// PlanBoard.planning.test.ts. Needs the conditions of `PlanBoard.svelte` and `conditions.ts` (implementation): fails until then.
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import type { ResolvedLink } from '../../kit/types.ts';
import { KUH, LAPS, SAMPLES_EDITED, cases } from './fixtures.ts';
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

const FULL = { mode: 'full', cols: 88, rows: 13, px: { width: 88 * 8, height: 13 * 19.6 }, dpr: 1 } as const;
const COMPACT = { mode: 'compact', cols: 37, rows: 7, px: { width: 37 * 8, height: 7 * 19.6 }, dpr: 1 } as const;
const LINK: ResolvedLink = { group: 1, feedId: feedId('20778'), primary: KUH, compare: [], window: { kind: 'live' } };

type Data = Record<string, unknown>;
type Size = typeof FULL | typeof COMPACT;

function mount(data: Data, size: Size = FULL) {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const sent: UiAction[] = [];
  const { container } = render(ActionsHarness, {
    send: (action: UiAction) => {
      sent.push(action);
      return Promise.resolve({ ok: true });
    },
    actions: widget.actions,
    component: PlanBoard as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: { source: 'planning' }, size, link: LINK },
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
/** The editor's row ids `cond-<i>` (not their fields). */
const condRows = (c: Element): string[] => all(c, 'cond-').map((e) => e.getAttribute('data-testid') ?? '').filter((id) => /^cond-\d+$/.test(id));
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const hovers = (el: Element): string[] => [el.closest('[title]'), ...el.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));
/** Sets a field's value and commits it (input then change). */
async function type(el: HTMLElement, value: string): Promise<void> {
  (el as HTMLInputElement).value = value;
  await fireEvent.input(el);
  await fireEvent.change(el);
}

describe('plan board: the race conditions per the mockup', () => {
  it('the inputs line shows RAIN 45 % and the label imported · Q 17 Nov', () => {
    const { container: c } = mount(cases.planningConditions);
    const inputs = get(c, 'inputs');
    expect(textOf(inputs)).toMatch(/RAIN\s*45\s*%/);
    expect(textOf(get(inputs, 'rain'))).toContain('45%');
    expect(get(inputs, 'rain').tagName).toBe('BUTTON');
    expect(textOf(get(inputs, 'conditions-source'))).toBe('imported · Q 17 Nov');
    // closed: the plan rows as before
    expect(all(c, 'row-').length).toBeGreaterThan(0);
    expect(find(c, 'conditions')).toBeNull();
  });

  it('clicking RAIN shows two rows (+0, +30)', async () => {
    const { container: c, sent } = mount(cases.planningConditions);
    await fireEvent.click(get(c, 'rain'));
    const editor = get(c, 'conditions');
    for (const part of ['+MIN', 'WEATHER', 'RAIN']) expect(textOf(editor), part).toContain(part);
    expect(textOf(get(editor, 'cond-reset'))).toBe('reset');
    expect(textOf(get(editor, 'cond-done'))).toBe('done');
    expect(condRows(c)).toEqual(['cond-0', 'cond-1']);
    expect([textOf(get(c, 'cond-0-at')), textOf(get(c, 'cond-1-at'))]).toEqual(['+0', '+30']);
    expect((get(c, 'cond-0-weather') as HTMLSelectElement).value).toBe('clear');
    expect((get(c, 'cond-1-weather') as HTMLSelectElement).value).toBe('lightRain');
    expect((get(c, 'cond-0-rain') as HTMLInputElement).value).toBe('1');
    expect((get(c, 'cond-1-rain') as HTMLInputElement).value).toBe('45');
    // in place of the plan rows
    expect(all(c, 'row-')).toHaveLength(0);
    expect(all(c, 'dp-')).toHaveLength(0);
    // opening is window-local: nothing invoked; done closes it
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    await fireEvent.click(get(c, 'cond-done'));
    expect(find(c, 'conditions')).toBeNull();
    expect(all(c, 'row-').length).toBeGreaterThan(0);
  });

  it('changing row 2\'s rain to 80 and committing invokes plans.race.set once with laps and sets unchanged and those conditions', async () => {
    const { container: c, sent } = mount(cases.planningConditions);
    await fireEvent.click(get(c, 'rain'));
    const rain = get(c, 'cond-1-rain') as HTMLInputElement;
    rain.value = '8';
    await fireEvent.input(rain);
    rain.value = '80';
    await fireEvent.input(rain);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await fireEvent.change(rain);
    expect(mocks.invoke.mock.calls).toEqual([
      ['plans.race.set', { feedId: LINK.feedId, race: { laps: LAPS, sets: 'carried', conditions: { kind: 'entered', samples: SAMPLES_EDITED } } }],
    ]);
    expect(sent).toEqual([]);
  });

  it('with an overridden row, the label reads edited and the row carries the emphasis role', async () => {
    const { container: c } = mount(cases.planningConditionsEdited);
    expect(textOf(get(c, 'conditions-source'))).toBe('edited');
    expect(textOf(get(c, 'rain'))).toContain('80%');
    await fireEvent.click(get(c, 'rain'));
    const edited = get(c, 'cond-1');
    const imported = get(c, 'cond-0');
    expect(edited.getAttribute('data-role')).toBe('text');
    expect(imported.getAttribute('data-role')).toBe('textDim');
    expect(textOf(edited)).toContain('edited');
    expect(textOf(imported)).not.toContain('edited');
    expect((get(c, 'cond-1-rain') as HTMLInputElement).value).toBe('80');
  });

  it('reset invokes plans.race.set with conditions: { kind: \'imported\' }', async () => {
    const { container: c, sent } = mount(cases.planningConditionsEdited);
    await fireEvent.click(get(c, 'rain'));
    await fireEvent.click(get(c, 'cond-reset'));
    expect(mocks.invoke.mock.calls).toEqual([['plans.race.set', { feedId: LINK.feedId, race: { laps: LAPS, sets: 'carried', conditions: { kind: 'imported' } } }]]);
    expect(sent).toEqual([]);
  });

  it('rows unknown(\'notReceived\'): RAIN shows the missing mark, never 0 %, and the editor offers one row to enter at +0 (Review focus 3)', async () => {
    const { container: c } = mount(cases.planningNoConditions);
    const rain = get(c, 'rain');
    expect(textOf(rain)).toContain('…');
    expect(textOf(rain)).not.toMatch(/\d\s*%/);
    expect(textOf(get(c, 'inputs'))).not.toMatch(/RAIN\s*0\s*%/);
    expect(textOf(find(c, 'conditions-source'))).not.toContain('imported');
    await fireEvent.click(rain);
    expect(find(c, 'conditions')).not.toBeNull();
    expect(condRows(c)).toEqual(['cond-0']);
    expect(textOf(get(c, 'cond-0-at'))).toBe('+0');
    expect((get(c, 'cond-0-rain') as HTMLInputElement).value).toBe('');
    expect(textOf(get(c, 'cond-add'))).toBe('+ row');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('in compact size the editor is not offered', () => {
    const { container: c } = mount(cases.planningConditions, COMPACT);
    expect(find(c, 'rain')).toBeNull();
    expect(find(c, 'conditions')).toBeNull();
    expect([...c.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('▸'))).toBe(false);
  });

  it('a rejection shows on the row (the rejected role), as laps do', async () => {
    const message = 'rain is 0 to 100 %';
    respond = () => Promise.resolve({ ok: false, reason: 'invalid', message });
    const { container: c } = mount(cases.planningConditions);
    await fireEvent.click(get(c, 'rain'));
    await type(get(c, 'cond-1-rain'), '101');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(get(c, 'cond-1-rain').getAttribute('data-role')).toBe('warning'));
    expect(hovers(get(c, 'cond-1-rain'))).toContain(message);
    // the other row is not marked
    expect(get(c, 'cond-0-rain').getAttribute('data-role')).not.toBe('warning');
  });
});
