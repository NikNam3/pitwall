// @vitest-environment jsdom
// The alarm list declares the uiActions it sends (C74, plan Task 12) and still sends them below a panel that passes its
// declared list to `setUiActions` (test/kit/ActionsHarness.svelte stands in for the panel). The component sends
// `alert.ack` (its ack button) and `alertGroup.mute` (its mute and unmute buttons), so its declaration lists both; in dev
// an undeclared kind would throw instead of reaching the panel.
import { ackToken, type UiAction } from '@pitwall/contracts';
import { carId, feedId, toSessionTime, type Insight } from '@pitwall/domain';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import AlarmList from './AlarmList.svelte';
import { widget } from './widget.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const brake: Insight = {
  key: 'bandOutLap:0:brakesC.fr', severity: 'critical', category: 'car', feedId: feedId('test'), carId: carId(0),
  kind: 'bandOutLap', params: { channel: 'brakesC.fr', lo: 300, hi: 900 }, raisedAt: toSessionTime(230_000),
};

function mount(alerts: { acknowledged: string[]; muted: string[] }): { container: HTMLElement; sent: UiAction[] } {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const sent: UiAction[] = [];
  const { container } = render(ActionsHarness, {
    send: (action: UiAction) => sent.push(action),
    actions: widget.actions,
    component: AlarmList as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data: { insights: new Map([[brake.key, brake]]), alerts },
      options: {},
      size: { mode: 'full', cols: 80, rows: 10, px: { width: 800, height: 200 }, dpr: 1 },
      link: {},
    },
  });
  return { container, sent };
}

const button = (container: HTMLElement, testId: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`no ${testId}`);
  return found;
};

describe('alarm-list: declared actions', () => {
  it('declares alert.ack and alertGroup.mute, the kinds it sends', () => {
    expect(widget.actions).toEqual(expect.arrayContaining(['alert.ack', 'alertGroup.mute']));
  });
});

describe('alarm-list still acks below a panel that passes its declared actions', () => {
  it('the ack button sends alert.ack with the insight\'s token', async () => {
    const { container, sent } = mount({ acknowledged: [], muted: [] });
    await fireEvent.click(button(container, `ack-${brake.key}`));
    expect(sent).toEqual([{ kind: 'alert.ack', key: ackToken(brake) }]);
  });
  it('the mute button sends alertGroup.mute for the insight\'s category', async () => {
    const { container, sent } = mount({ acknowledged: [], muted: [] });
    await fireEvent.click(button(container, `mute-${brake.category}-${brake.key}`));
    expect(sent).toEqual([{ kind: 'alertGroup.mute', category: 'car', muted: true }]);
  });
  it('the unmute button sends alertGroup.mute with muted false', async () => {
    const { container, sent } = mount({ acknowledged: [], muted: ['car'] });
    await fireEvent.click(button(container, 'unmute-car'));
    expect(sent).toEqual([{ kind: 'alertGroup.mute', category: 'car', muted: false }]);
  });
});
