// @vitest-environment jsdom
// The ers-budget trend line (wave 2, T7; review-ui findings 3 and 6): an unknown attack text shows its reason's mark,
// faint, the reason on hover, never an empty end of line; the trend and the attack are joined once, as the view says.
import { cleanup, render } from '@testing-library/svelte';
import { known, toSessionTime, unknown, type ErsState } from '@pitwall/domain';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { role } from '../../theme/index.ts';
import ErsBudget from './ErsBudget.svelte';
import * as text from './text.ts';

afterEach(cleanup);

const at = toSessionTime(10);
const MJ = 1_000_000;
const state = (over: Partial<ErsState> = {}): ErsState => ({
  storeJ: known(1.9 * MJ, at), capacityJ: 4 * MJ, deployedThisLapJ: known(2.1 * MJ, at), deployLimitJ: 4 * MJ,
  harvestedThisLapJ: known(1.3 * MJ, at), storeTrendJPerLap: known(0.4 * MJ, at), attackLevelJ: 2.5 * MJ,
  attack: known({ ready: false, inLaps: 2 }, at), mode: known('medium', at), flow: known('harvesting', at), ...over,
});

const show = (ers: ErsState, mode: 'compact' | 'full' = 'full') =>
  render(InPanel, {
    component: ErsBudget as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { ers, moment: undefined }, options: {}, size: { mode, cols: 64, rows: 6, px: { width: 640, height: 120 }, dpr: 1 }, link: {} },
  }).container;

/** The trend line: the innermost line holding the attack text or, in compact, the last line. */
const trendLine = (c: HTMLElement): string => {
  const lines = [...c.querySelectorAll('div')].filter((d) => d.querySelector('div') === null);
  return (lines[lines.length - 1]?.textContent ?? '').replace(/[ \t\n]+/g, ' ').trim();
};

/** The faint mark of the reason, with its hover. */
const marks = (c: HTMLElement, reason: keyof typeof unknownMark): HTMLElement[] =>
  [...c.querySelectorAll<HTMLElement>('*')].filter(
    (e) => e.textContent?.trim() === unknownMark[reason] && e.style.color === role('textFaint') && e.closest('[title]')?.getAttribute('title') === unknownReason[reason],
  );

describe('ErsBudget: the trend line', () => {
  it.each(['full', 'compact'] as const)('%s: an unknown attack shows its mark after the joint, the reason on hover', (mode) => {
    const c = show(state({ attack: unknown('insufficientData') }), mode);
    expect(trendLine(c).endsWith(`+0.4 ${text.perLap}${text.joint}${unknownMark.insufficientData}`)).toBe(true);
    expect(marks(c, 'insufficientData')).toHaveLength(1);
  });

  it('a realism-hidden attack shows the realism mark, as every other hidden value of the car', () => {
    const c = show(state({ storeTrendJPerLap: unknown('realism'), attack: unknown('realism') }));
    expect(trendLine(c).endsWith(`${unknownMark.realism}${text.joint}${unknownMark.realism}`)).toBe(true);
  });

  it('an unknown trend shows its mark, joined once to the attack text', () => {
    const c = show(state({ storeTrendJPerLap: unknown('notReceived') }));
    const line = trendLine(c);
    expect(line.endsWith(`${unknownMark.notReceived}${text.joint}${text.attackIn(2)}`)).toBe(true);
    expect(line.split(text.joint)).toHaveLength(2);
  });
});
