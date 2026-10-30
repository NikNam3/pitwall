// @vitest-environment jsdom
// The damage card's jump loss (Task DL): a loss that can never be measured says so, titled with the reason.
import { cleanup, render } from '@testing-library/svelte';
import { known, unknown, type DamageJump, type DamageParts, type DamageState } from '@pitwall/domain';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import DamageCard from './DamageCard.svelte';

afterEach(cleanup);

const PARTS: DamageParts = {
  frontLeftWingPct: 18, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0, gearboxPct: 0, enginePct: 0,
};
const corner = { tyrePct: known(0, 0), brakePct: known(0, 0) };
const jump = (lossMsPerLap: DamageJump['lossMsPerLap']): DamageJump => ({ at: 150_000, lap: 2, parts: ['frontLeftWingPct'], deltaPct: 18, lossMsPerLap });
const damage = (j: DamageJump): DamageState => ({
  parts: known(PARTS, 0), corners: { fl: corner, fr: corner, rl: corner, rr: corner }, drsFault: known(false, 0), ersFault: false, jumps: [j],
});

const show = (j: DamageJump) =>
  render(InPanel, {
    component: DamageCard as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { damage: damage(j) }, options: {}, size: { mode: 'full', cols: 60, rows: 12, px: { width: 600, height: 240 }, dpr: 1 }, link: {} },
    cadenceMs: 50,
  });
const lossSpan = (c: HTMLElement, text: string): HTMLElement | undefined =>
  [...c.querySelectorAll('span')].find((s) => s.textContent === text);

describe('DamageCard: jump loss', () => {
  it('shows "loss: not measurable" titled with the reason for a loss that can never be measured', () => {
    const { container } = show(jump(unknown('notApplicable')));
    const span = lossSpan(container, 'loss: not measurable');
    expect(span).toBeDefined();
    expect(span!.title).toBe('too few clean laps before the hit');
  });

  it('keeps "loss: measuring" for a loss still waiting for laps', () => {
    const { container } = show(jump(unknown('insufficientData')));
    expect(lossSpan(container, 'loss: measuring')).toBeDefined();
    expect(container.textContent).not.toContain('not measurable');
  });
});
