// @vitest-environment jsdom
// The damage card's jump loss (Task DL, review 9 R9-1): every loss state as the card draws it; a loss that can never be
// measured says so, titled with the reason; a hidden loss shows its reason's mark in place.
import { cleanup, render } from '@testing-library/svelte';
import { known, unknown, type DamageJump, type DamageParts, type DamageState, type UnknownReason } from '@pitwall/domain';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { unknownMark, unknownReason } from '../../kit/text.ts';
import { role } from '../../theme/index.ts';
import DamageCard from './DamageCard.svelte';

afterEach(cleanup);

const PARTS: DamageParts = {
  frontLeftWingPct: 18, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0, gearboxPct: 0, enginePct: 0,
};
const corner = { tyrePct: known(0, 0), brakePct: known(0, 0) };
/** A jump with this loss; not measuring and without an estimate (the card's plain loss texts). */
const jump = (lossMsPerLap: DamageJump['lossMsPerLap']): DamageJump => ({
  at: 150_000, lap: 2, parts: ['frontLeftWingPct'], deltaPct: 18, lossMsPerLap, measuring: unknown('notApplicable'), estimateMsPerLap: unknown('notApplicable'),
});
const damage = (j: DamageJump): DamageState => ({
  parts: known(PARTS, 0), corners: { fl: corner, fr: corner, rl: corner, rr: corner }, drsFault: known(false, 0), ersFault: false, jumps: [j],
});

const FULL = { mode: 'full', cols: 60, rows: 12, px: { width: 600, height: 240 }, dpr: 1 } as const;
const COMPACT = { mode: 'compact', cols: 26, rows: 2, px: { width: 260, height: 40 }, dpr: 1 } as const;
const show = (j: DamageJump, size: typeof FULL | typeof COMPACT = FULL) =>
  render(InPanel, {
    component: DamageCard as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { damage: damage(j) }, options: {}, size, link: {} },
    cadenceMs: 50,
  });
/** The innermost element that shows exactly `text`. */
const shownAs = (c: HTMLElement, text: string): HTMLElement | undefined =>
  [...c.querySelectorAll<HTMLElement>('*')].find((e) => e.textContent === text && ![...e.children].some((k) => k.textContent === text));
/** The hover text over an element: its own title or that of a cell around it. */
const hover = (e: HTMLElement): string | null => e.closest('[title]')?.getAttribute('title') ?? null;
const HIDDEN: UnknownReason[] = ['restricted', 'notReceived', 'realism'];

// Every loss state of a jump row (R9-1: the loss is a cell part drawn by the kit; the row's title explains "not measurable").
describe('DamageCard: jump loss', () => {
  it('shows a measured loss as its text, with no hover text', () => {
    const { container } = show(jump(known(120, 160_000)));
    const loss = shownAs(container, 'loss +0.12 s/lap');
    expect(loss).toBeDefined();
    expect(hover(loss!)).toBeNull();
  });

  it('shows "loss: measuring" for a loss still waiting for laps, with no hover text', () => {
    const { container } = show(jump(unknown('insufficientData')));
    const loss = shownAs(container, 'loss: measuring');
    expect(loss).toBeDefined();
    expect(hover(loss!)).toBeNull();
    expect(container.textContent).not.toContain('not measurable');
  });

  it('shows "loss: not measurable" titled with the reason for a loss that can never be measured', () => {
    const { container } = show(jump(unknown('notApplicable')));
    const loss = shownAs(container, 'loss: not measurable');
    expect(loss).toBeDefined();
    expect(hover(loss!)).toBe('too few clean laps before the hit');
  });

  it.each(HIDDEN)("shows a %s loss as its reason's mark after the jump, faint, with the reason on hover", (reason) => {
    const { container } = show(jump(unknown(reason)));
    const line = [...container.querySelectorAll<HTMLElement>('.line')].find((l) => l.textContent?.includes('L02 FL wing +18 %'));
    expect(line).toBeDefined();
    const marks = [...line!.querySelectorAll<HTMLElement>('*')].filter((e) => e.textContent === unknownMark[reason] && e.children.length === 0);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.style.color).toBe(role('textFaint'));
    expect(hover(marks[0]!)).toBe(unknownReason[reason]);
    expect(line!.textContent).not.toContain('loss');
  });
});

// The compact view shows the newest jump's text and hovers its loss (supervisor ruling, wave 10): the loss text when the
// card says it, the kit's hover text of the reason when the loss is unknown, never an empty hover.
describe('DamageCard compact: the jump hovers its loss', () => {
  const JUMP_TEXT = 'L02 FL wing +18 %';

  it.each([
    ['measured', known(120, 160_000), 'loss +0.12 s/lap'],
    ['measuring', unknown('insufficientData'), 'loss: measuring'],
    ['not measurable', unknown('notApplicable'), 'loss: not measurable'],
    ...HIDDEN.map((reason): [string, DamageJump['lossMsPerLap'], string] => [reason, unknown(reason), unknownReason[reason]]),
  ] as Array<[string, DamageJump['lossMsPerLap'], string]>)('a %s loss: the jump line hovers its loss text, or the reason when unknown', (_, loss, title) => {
    const { container } = show(jump(loss), COMPACT);
    const line = shownAs(container, JUMP_TEXT);
    expect(line).toBeDefined();
    expect(hover(line!)).toBe(title);
  });
});
