// @vitest-environment jsdom
// The alarm list declares the uiActions it sends (C74, plan Task 12) and still sends them below a panel that passes its
// declared list to `setUiActions` (test/kit/ActionsHarness.svelte stands in for the panel). The component sends
// `alert.ack` (its ack button) and `alertGroup.mute` (its mute and unmute buttons), so its declaration lists both; in dev
// an undeclared kind would throw instead of reaching the panel.
import { ackToken, type CarOverview, type UiAction } from '@pitwall/contracts';
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

const overview = (id: number, name: string, raceNumber: number): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
/** Our cars: the player (car 0) and the teammate (car 5). */
const CARS = [overview(0, 'Lando Norris', 4), overview(5, 'Oscar Piastri', 81)];

function mount(
  alerts: { acknowledged: string[]; muted: string[] },
  o: { insights?: Insight[]; cars?: CarOverview[] } = {},
): { container: HTMLElement; sent: UiAction[] } {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const sent: UiAction[] = [];
  const insights = o.insights ?? [brake];
  const { container } = render(ActionsHarness, {
    send: (action: UiAction) => sent.push(action),
    actions: widget.actions,
    component: AlarmList as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data: { insights: new Map(insights.map((i) => [i.key, i])), alerts, cars: o.cars ?? CARS },
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

describe('alarm-list: every row names its car', () => {
  const line = (container: HTMLElement, key: string) => container.querySelector(`[data-testid="alarm-${key}"] .insight-line`)?.textContent ?? '';
  const wing: Insight = {
    key: 'damageJump:5:140000', severity: 'critical', category: 'damage', feedId: feedId('test'), carId: carId(5),
    kind: 'damageJump', params: { lap: 12, parts: 'frontLeftWingPct', deltaPct: 40 }, raisedAt: toSessionTime(140_000),
  };

  it('declares cars.overview as data: the code comes from the car of the insight', () => {
    expect(widget.data).toHaveProperty('cars');
  });

  it("a row shows the car's code, the separator, then the text: the player's and the teammate's alarms told apart", () => {
    const { container } = mount({ acknowledged: [], muted: [] }, { insights: [brake, wing] });
    expect(line(container, brake.key)).toBe('NOR · FR brake out of band a full lap');
    expect(line(container, wing.key)).toBe('PIA · damage: FL wing +40 %');
  });

  it('a row whose car is not in cars.overview, or without a car, shows the text alone', () => {
    const { carId: _car, ...rest } = wing;
    const noCar: Insight = { ...rest, key: 'x:none' };
    const { container } = mount({ acknowledged: [], muted: [] }, { insights: [wing, noCar], cars: [CARS[0]!] });
    expect(line(container, wing.key)).toBe('damage: FL wing +40 %');
    expect(line(container, noCar.key)).toBe('damage: FL wing +40 %');
  });
});

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
