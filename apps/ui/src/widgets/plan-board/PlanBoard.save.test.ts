// @vitest-environment jsdom
// SP4.3f Task 10 (spec §4.4 "Saving in the panel"; the user's layout of 2026-11-18 in the plan's Task 10; C65, C68,
// C72, C74): the planning line's `save`. Contract assumed of `PlanBoard.svelte` on top of PlanBoard.planning.test.ts:
//  - planning variant, full size: the inputs line `[data-testid="inputs"]` ends with `<button data-testid="save">`
//    (`save`, the board's `text.ts`); compact size has none;
//  - clicking it invokes the declared shell command `plans.save.pick` once through the panel (`kit/commands.ts`
//    `getWidgetCommands().invoke`, C72, C74), which opens the shell's name prompt; the board sends no uiAction itself;
//  - with the open round's `lastSaved` (`plans.prepared`, absent or `null` until a save) the line ends with
//    `[data-testid="saved"]` reading `saved · <name>` in place of `save` (presentation only, C65).
// The panel's commands are stubbed (vi.mock of kit/commands.ts, throwing on an undeclared id as the panel does in dev).
// Fails until the button, the label and the declaration's `plans.save.pick` exist (implementation).
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import type { ResolvedLink } from '../../kit/types.ts';
import { KUH, LAST_SAVED, cases, preview, round } from './fixtures.ts';
import PlanBoard from './PlanBoard.svelte';
import { widget } from './widget.ts';

const mocks = vi.hoisted(() => ({ invoke: vi.fn<(id: string, args: unknown) => Promise<ActionOutcome>>() }));
vi.mock('../../kit/commands.ts', () => ({
  getWidgetCommands: () => ({ invoke: mocks.invoke }),
  setWidgetCommands: () => undefined,
}));

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((id: string) => {
    if (!(widget.commands as readonly string[]).includes(id)) throw new Error(`command "${id}" is not declared by the widget (C74)`);
    return Promise.resolve({ ok: true });
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
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const invoked = (): string[] => mocks.invoke.mock.calls.map(([id]) => id);

describe('plan board: saving the round (the user\'s layout)', () => {
  it('the planning line ends with save (full size)', () => {
    const { container: c } = mount(cases.planningRound);
    const inputs = get(c, 'inputs');
    const save = get(inputs, 'save');
    expect(save.tagName).toBe('BUTTON');
    expect(textOf(save)).toBe('save');
    expect(textOf(inputs).endsWith('save')).toBe(true);
    const buttons = [...inputs.querySelectorAll('button')];
    expect(buttons.at(-1)).toBe(save);
    expect(find(c, 'saved')).toBeNull();
  });

  it('compact size has no save', () => {
    const { container: c } = mount(cases.planningRound, COMPACT);
    expect(find(c, 'save')).toBeNull();
  });

  it('clicking save invokes plans.save.pick once and sends no uiAction', async () => {
    const { container: c, sent } = mount(cases.planningRound);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await fireEvent.click(get(c, 'save'));
    expect(invoked()).toEqual(['plans.save.pick']);
    expect(sent).toEqual([]);
  });

  it('with lastSaved the line shows "saved · Texas 18 Nov 17:20" in place of save', () => {
    const { container: c } = mount(cases.planningSaved);
    const inputs = get(c, 'inputs');
    expect(textOf(get(inputs, 'saved'))).toBe('saved · Texas 18 Nov 17:20');
    expect(textOf(inputs).endsWith('saved · Texas 18 Nov 17:20')).toBe(true);
    expect(find(c, 'save')).toBeNull();
  });

  it('lastSaved null (no save yet) keeps save', () => {
    const { container: c } = mount({ preview: preview(), prepared: round({ lastSaved: null }) });
    expect(find(c, 'save')).not.toBeNull();
    expect(find(c, 'saved')).toBeNull();
  });

  it('the gallery case planningSaved: the open round with lastSaved', () => {
    const r = cases.planningSaved.prepared;
    expect(r.open && r.lastSaved).toEqual(LAST_SAVED);
    expect(LAST_SAVED.name).toBe('Texas 18 Nov 17:20');
  });
});
