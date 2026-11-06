// @vitest-environment jsdom
// Declared widget actions (C74, plan Task 12). Contract the tests assume of `kit/actions.ts`:
//  - `setUiActions(send, actions)`: the panel hands its `send` and the widget's declared kinds (`decl.actions`);
//  - `getUiActions().send(action)` passes a declared kind to the panel's `send`; a kind the widget did not declare is
//    never sent: in dev (`import.meta.env.DEV`, read when the action is sent) it throws, in production it is dropped
//    without a throw;
//  - outside a panel (gallery, tests) `send` stays a no-op that never throws.
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

/** The widget's `send`, below a panel that declared `actions`; `sent` collects what reached the panel. */
function widgetSend(actions: readonly UiAction['kind'][]): { send: (action: UiAction) => void; sent: UiAction[] } {
  const sent: UiAction[] = [];
  let send: ((action: UiAction) => void) | undefined;
  render(ActionsHarness, {
    send: (action: UiAction) => sent.push(action),
    actions,
    component: ActionsProbe as unknown as Component<Record<string, unknown>>,
    widgetProps: { onSend: (s: (action: UiAction) => void) => (send = s) },
  });
  if (send === undefined) throw new Error('the probe got no send');
  return { send, sent };
}

describe('getUiActions: a declared action is sent', () => {
  it('a declared kind reaches the panel\'s send unchanged', () => {
    const { send, sent } = widgetSend(['alert.ack', 'alertGroup.mute']);
    send(ack);
    send(mute);
    expect(sent).toEqual([ack, mute]);
  });
});

describe('getUiActions: an undeclared action is not sent', () => {
  it('in dev it throws and the panel\'s send is not called', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    const { send, sent } = widgetSend(['alert.ack']);
    expect(() => send(mute)).toThrow();
    expect(sent).toEqual([]);
  });
  it('in production it is dropped without a throw', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const { send, sent } = widgetSend(['alert.ack']);
    expect(() => send(mute)).not.toThrow();
    expect(sent).toEqual([]);
  });
  it('a widget that declares no action sends nothing', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const { send, sent } = widgetSend([]);
    send(ack);
    expect(sent).toEqual([]);
  });
  it('the declared list of the panel above decides, not any other kind\'s presence', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const { send, sent } = widgetSend(['alertGroup.mute']);
    send(ack);
    send(mute);
    expect(sent).toEqual([mute]);
  });
});

describe('getUiActions outside a panel', () => {
  it('is a no-op send that never throws (gallery, tests)', () => {
    let send: ((action: UiAction) => void) | undefined;
    render(ActionsProbe, { onSend: (s: (action: UiAction) => void) => (send = s) });
    expect(send).toBeDefined();
    expect(() => send?.(ack)).not.toThrow();
  });
});
