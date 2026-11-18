// @vitest-environment jsdom
// SP4.3e Task 7c-2 (spec §4.3 "the race assumptions"; C65, C72–C74): the plan board's race-assumptions fields in the
// planning round. `prepared` is `plans.prepared`'s value after Task 7b (`PlanningRoundState`, open, with
// `race: { laps, sets }`). Contract assumed of `PlanBoard.svelte`, on top of PlanBoard.planning.test.ts:
//  - the inputs line holds the laps field `<input data-testid="laps">` (its value `prepared.race.laps`) and the sets
//    field `<select data-testid="sets">` with the options `carried` and `fresh` (its value `prepared.race.sets`);
//  - typing in the laps field is window-local (C73); committing it (its `change`) invokes the command `plans.race.set`
//    once with `{ feedId: link.feedId, race: { laps: <the number>, sets: <the round's sets> } }`;
//  - changing the sets invokes `plans.race.set` once with `{ feedId, race: { laps: <the round's laps>, sets } }`;
//  - a rejected value (`{ ok: false, message }`) marks the field with the warning role and the bridge's message as its hover.
// `plans.race.set` must be a widget command (`kit/command-types.ts`, requested of the supervisor) the declaration lists
// (`widget.ts` `commands`, C74); the stubbed panel throws on an undeclared id. Fails until then.
import type { ActionOutcome, PlanningRoundState, UiAction } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import type { ResolvedLink } from '../../kit/types.ts';
import { KUH, KUH_NUMBER, TEAM, plan, preview } from './fixtures.ts';
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

/** The open round after Task 7b: the 17 Nov qualifying, no practice, 56 laps on a fresh allocation. */
const ROUND: PlanningRoundState = {
  open: true,
  qualifying: { sessionUid: '12101553556244014932', weekendId: '548397152' },
  practice: [],
  race: { laps: 56, sets: 'fresh' },
  team: TEAM,
  cars: { [KUH]: { raceNumber: KUH_NUMBER, slots: {}, active: null } },
  running: false,
  saved: [],
};

function mount() {
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
    widgetProps: { data: { plan: plan(), preview: preview(), prepared: ROUND }, options: { source: 'planning' }, size: SIZE, link: LINK },
  });
  return { container, sent };
}

function get(c: Element, id: string): HTMLElement {
  const el = c.querySelector(`[data-testid="${id}"]`);
  if (el === null) throw new Error(`no ${id}`);
  return el as HTMLElement;
}
const hovers = (el: Element): string[] => [el.closest('[title]'), ...el.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));

describe('plan board: the race assumptions (plans.race.set)', () => {
  it('the inputs line shows the round\'s laps and sets', () => {
    const { container: c } = mount();
    const inputs = get(c, 'inputs');
    expect((get(inputs, 'laps') as HTMLInputElement).value).toBe('56');
    const sets = get(inputs, 'sets') as HTMLSelectElement;
    expect([...sets.options].map((o) => o.value)).toEqual(['carried', 'fresh']);
    expect(sets.value).toBe('fresh');
  });

  it('laps: typing sends nothing; committing invokes plans.race.set once with the round\'s sets', async () => {
    const { container: c, sent } = mount();
    const laps = get(c, 'laps') as HTMLInputElement;
    laps.value = '2';
    await fireEvent.input(laps);
    laps.value = '20';
    await fireEvent.input(laps);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await fireEvent.change(laps);
    expect(mocks.invoke.mock.calls).toEqual([['plans.race.set', { feedId: LINK.feedId, race: { laps: 20, sets: 'fresh' } }]]);
    expect(sent).toEqual([]);
  });

  it('sets: choosing carried invokes plans.race.set once with the round\'s laps', async () => {
    const { container: c } = mount();
    const sets = get(c, 'sets') as HTMLSelectElement;
    sets.value = 'carried';
    await fireEvent.change(sets);
    expect(mocks.invoke.mock.calls).toEqual([['plans.race.set', { feedId: LINK.feedId, race: { laps: 56, sets: 'carried' } }]]);
  });

  it('a rejected laps value: the field amber with the bridge\'s message on hover', async () => {
    const message = 'laps must be a whole number of at least 1';
    respond = () => Promise.resolve({ ok: false, reason: 'invalid', message });
    const { container: c } = mount();
    const laps = get(c, 'laps') as HTMLInputElement;
    laps.value = '0';
    await fireEvent.input(laps);
    await fireEvent.change(laps);
    await vi.waitFor(() => expect(get(c, 'laps').getAttribute('data-role')).toBe('warning'));
    expect(hovers(get(c, 'laps'))).toContain(message);
  });

  it('the declaration lists plans.race.set (C74)', () => {
    expect(widget.commands as readonly string[]).toContain('plans.race.set');
  });
});
