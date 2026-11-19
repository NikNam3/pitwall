// @vitest-environment jsdom
// SP4.3f Task 10 (spec §4.4 "Saving in the panel"; the user's layout of 2026-11-18 in the plan's Task 10; C65, C68,
// C72, C74): the planning line's `save`. Contract assumed of `PlanBoard.svelte` on top of PlanBoard.planning.test.ts:
//  - planning variant, full size: SP4.3f Task 11 (mockup round 2, gen.mjs `saveLine`, `boardWith`): the body's last row
//    (its last `div.line`) ends with `<button data-testid="save">` (`save`, the board's `text.ts`), never an inputs line
//    (`[data-testid="inputs"]`); a rejection (`[data-testid="rejection"]`) shares that row, before `save`; compact size
//    has none;
//  - clicking it invokes the declared shell command `plans.save.pick` once through the panel (`kit/commands.ts`
//    `getWidgetCommands().invoke`, C72, C74), which opens the shell's name prompt; the board sends no uiAction itself;
//  - with the open round's `lastSaved` (`plans.prepared`, absent or `null` until a save) the last row ends with
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
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const invoked = (): string[] => mocks.invoke.mock.calls.map(([id]) => id);
/** The body's last row: its last line in document order. */
function lastRow(c: Element): HTMLElement {
  const last = [...c.querySelectorAll('div.line')].at(-1);
  if (last === undefined) throw new Error('no line');
  return last as HTMLElement;
}

describe('plan board: saving the round (the user\'s layout, mockup round 2)', () => {
  it('save is on the body\'s last row and not on an inputs line (full size)', () => {
    const { container: c } = mount(cases.planningRound);
    const last = lastRow(c);
    const save = get(last, 'save');
    expect(save.tagName).toBe('BUTTON');
    expect(textOf(save)).toBe('save');
    expect(textOf(last)).toBe('save');
    expect([...last.querySelectorAll('button')].at(-1)).toBe(save);
    expect(find(get(c, 'inputs'), 'save')).toBeNull();
    expect(find(c, 'saved')).toBeNull();
  });

  it('save is on the last row in every planning case at full size', () => {
    for (const data of [cases.planningComputing, cases.planningNoLaps, cases.planningConditions, cases.planningNoConditions]) {
      const { container: c } = mount(data);
      expect(find(lastRow(c), 'save')).not.toBeNull();
      expect(find(get(c, 'inputs'), 'save')).toBeNull();
      cleanup();
    }
  });

  it('a rejection shares the last row with save', async () => {
    const message = 'the round is closed';
    respond = () => Promise.resolve({ ok: false, reason: 'invalid', message });
    const { container: c } = mount(cases.planningRound);
    await fireEvent.click(get(c, 'accept-B'));
    await vi.waitFor(() => expect(find(c, 'rejection')).not.toBeNull());
    const last = lastRow(c);
    const rejection = get(last, 'rejection');
    const save = get(last, 'save');
    expect(textOf(rejection)).toContain(message);
    expect(rejection.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(c.querySelectorAll('div.line')).toHaveLength(13);
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

  it('with lastSaved the last row shows "saved · Texas 18 Nov 17:20" in place of save', () => {
    const { container: c } = mount(cases.planningSaved);
    const last = lastRow(c);
    expect(textOf(get(last, 'saved'))).toBe('saved · Texas 18 Nov 17:20');
    expect(textOf(last).endsWith('saved · Texas 18 Nov 17:20')).toBe(true);
    expect(find(get(c, 'inputs'), 'saved')).toBeNull();
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
