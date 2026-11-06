// @vitest-environment jsdom
// A widget's `send` returns the outcome of its action (C73, C74, Task k1). Contract the tests assume of `kit/actions.ts`:
//  - `getUiActions().send(action)` returns a promise of the outcome (`{ ok: true }` or `{ ok: false, reason, message? }`);
//  - a declared kind returns what the panel's `send` returns (the topic store's promise, passed through the panel);
//  - an undeclared kind resolves `{ ok: false, reason: 'notSupported' }` without calling the panel's `send` (in
//    production; in dev it still throws, `ui-actions.test.ts`);
//  - outside a panel (gallery, tests) it resolves `{ ok: true }`.
import type { UiAction } from '@pitwall/contracts';
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from './ActionsHarness.svelte';
import ActionsProbe from './ActionsProbe.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const ack: UiAction = { kind: 'alert.ack', key: 'f1:a:1000' };
const mute: UiAction = { kind: 'alertGroup.mute', category: 'tyres', muted: true };

type Send = (action: UiAction) => unknown;

/** The widget's `send` below a panel that declared `actions` and whose own `send` answers with `answer`. */
function widgetSend(actions: readonly UiAction['kind'][], answer: (action: UiAction) => Promise<unknown>): { send: Send; sent: UiAction[] } {
  const sent: UiAction[] = [];
  let send: Send | undefined;
  render(ActionsHarness, {
    send: (action: UiAction) => {
      sent.push(action);
      return answer(action);
    },
    actions,
    component: ActionsProbe as unknown as Component<Record<string, unknown>>,
    widgetProps: { onSend: (s: Send) => (send = s) },
  });
  if (send === undefined) throw new Error('the probe got no send');
  return { send, sent };
}

describe('getUiActions: the outcome of a widget\'s action', () => {
  it('a declared kind resolves with the outcome of the panel\'s send', async () => {
    const { send, sent } = widgetSend(['alert.ack'], () => Promise.resolve({ ok: false, reason: 'invalid', message: 'unknown alert' }));
    expect(await send(ack)).toEqual({ ok: false, reason: 'invalid', message: 'unknown alert' });
    expect(sent).toEqual([ack]);
  });

  it('a widget\'s send resolves notSupported for an undeclared kind and sends nothing', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const { send, sent } = widgetSend(['alert.ack'], () => Promise.resolve({ ok: true }));
    expect(await send(mute)).toEqual({ ok: false, reason: 'notSupported' });
    expect(sent).toEqual([]);
  });

  it('outside a panel send resolves ok', async () => {
    let send: Send | undefined;
    render(ActionsProbe, { onSend: (s: Send) => (send = s) });
    expect(send).toBeDefined();
    expect(await send?.(ack)).toEqual({ ok: true });
  });
});
