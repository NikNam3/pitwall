// @vitest-environment jsdom
// SP4.3d2 Task 12 "supervisor first" (C72, C74): a widget invokes a shell command by id with arguments through its panel.
//  - `declareWidget({ commands })` lists the command ids the widget may invoke (`decl.commands`, `[]` when omitted);
//  - the panel hands its `invoke` prop (the registry's `invoke`) to the widget through `kit/commands.ts`
//    (`getWidgetCommands().invoke(id, args)`), for the declared ids only; the outcome resolves back to the widget (C73);
//  - an undeclared id never reaches `invoke`: in dev it throws, in production it resolves `notSupported`;
//  - outside a panel `invoke` runs nothing and resolves `notSupported` (SP4.3e Task 8).
import type { ActionOutcome, PanelSpec } from '@pitwall/contracts';
import { carId, feedId } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import { declareWidget, topic } from '../../src/kit/define-widget.ts';
import type { ResolvedLink } from '../../src/kit/types.ts';
import Panel from '../../src/shell/panel/Panel.svelte';
import { FakeConnection } from '../connection/fake-connection.ts';
import commandProbe from './fixtures/command-probe/register.ts';
import { stubBrowser } from './shell-harness.ts';

const FEED = feedId('f1');
const LINK: ResolvedLink = { group: 1, feedId: FEED, primary: carId(5), compare: [], window: { kind: 'live' } };
const SPEC: PanelSpec = { widget: 'command-probe', options: {}, linkGroup: 1 };

beforeEach(stubBrowser);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const mountProbe = async (invoke: (id: string, args: unknown) => Promise<ActionOutcome>) => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  render(Panel, { store, spec: SPEC, widget: commandProbe, link: LINK, invoke });
  for (const s of connection.subscribes().filter((x) => x.topic === 'feed.status')) {
    connection.push({ type: 'snapshot', id: s.id, value: { feedId: FEED, connected: true, stale: false, betweenSessions: false } });
  }
  await vi.waitFor(() => expect(screen.getByTestId('laps')).toBeTruthy());
};
const click = async (id: string): Promise<void> => {
  await fireEvent.click(screen.getByTestId(id));
  await tick();
  await tick();
};

describe('the declaration lists the commands a widget invokes', () => {
  it('commands defaults to none', () => {
    const w = declareWidget({ name: 'plain', title: 'P', data: { status: topic('feed.status') }, sizes: { c: { minCols: 1, minRows: 1 } } });
    expect(w.commands).toEqual([]);
    expect(commandProbe.decl.commands).toEqual(['plans.race.set']);
  });
});

describe('the panel path: a widget invokes a declared command by id with arguments', () => {
  it('a declared id reaches the panel\'s invoke with its arguments, and its outcome reaches the widget', async () => {
    const invoke = vi.fn((): Promise<ActionOutcome> => Promise.resolve({ ok: false, reason: 'invalid' }));
    await mountProbe(invoke);
    await click('laps');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('plans.race.set', { feedId: FEED, race: { laps: 52, sets: 'carried', conditions: { kind: 'imported' } } });
    await vi.waitFor(() => expect(screen.getByTestId('outcome').textContent).toBe('invalid'));
  });

  it('an undeclared id is rejected: in dev it throws and invoke is not called', async () => {
    vi.stubEnv('DEV', true);
    const invoke = vi.fn((): Promise<ActionOutcome> => Promise.resolve({ ok: true }));
    await mountProbe(invoke);
    await click('undeclared');
    await vi.waitFor(() => expect(screen.getByTestId('outcome').textContent).toBe('thrown'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('an undeclared id is rejected: in production it resolves notSupported and invoke is not called', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const invoke = vi.fn((): Promise<ActionOutcome> => Promise.resolve({ ok: true }));
    await mountProbe(invoke);
    await click('undeclared');
    await vi.waitFor(() => expect(screen.getByTestId('outcome').textContent).toBe('notSupported'));
    expect(invoke).not.toHaveBeenCalled();
  });
});
