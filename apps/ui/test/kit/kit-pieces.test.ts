// @vitest-environment jsdom
// The car care kit pieces as components (spec 8.4, A.4). Contracts assumed of the Svelte files:
//  - `kit/corners/CornerGrid.svelte`: four elements `[data-corner="fl|fr|rl|rr"]`, in document order fl, fr, rl, rr
//    (two rows of two: FL FR / RL RR), each holding the `cell` snippet's output for that corner;
//  - `kit/bar/Bar.svelte`: root element `.bar` whose text is `barCells(...).text` (no other text), inline
//    `color: <role(props.role)>`; an unknown value sets `title` to `unknownReason[reason]`, a known one has no title;
//  - `kit/compound/CompoundMark.svelte`: root `.compound` whose text is the letter (S, M, H, I, W, SS for superSoft, ?
//    for unknown) followed directly by the age when given (`M12`); its colour is inline `color: <role('compoundSoft'
//    | 'compoundMedium' | 'compoundHard')>` (the theme variant decides whether that role is grey or coloured), textFaint
//    for inter, wet, superSoft and unknown;
//  - `kit/insight/InsightLine.svelte`: root `.insight-line` whose text contains `formatInsight(insight)`; inline colour
//    `role('textFaint')` when acknowledged, else `role('critical')` for a critical insight, `role('warning')` for an
//    advisory one and `role('textDim')` for info; attribute `data-severity=<severity>`.
import { cleanup, render } from '@testing-library/svelte';
import { feedId, known, unknown, type Insight, type SessionTime, type VisualCompound } from '@pitwall/domain';
import { afterEach, describe, expect, it } from 'vitest';
import Bar from '../../src/kit/bar/Bar.svelte';
import { barCells } from '../../src/kit/bar/bar.ts';
import CompoundMark from '../../src/kit/compound/CompoundMark.svelte';
import InsightLine from '../../src/kit/insight/InsightLine.svelte';
import { formatInsight } from '../../src/kit/insight/insight-text.ts';
import { unknownReason } from '../../src/kit/text.ts';
import { role } from '../../src/theme/index.ts';
import CornerGridHarness from './CornerGridHarness.svelte';

afterEach(cleanup);
const at = 0 as SessionTime;

describe('CornerGrid', () => {
  it('lays the corners out FL FR / RL RR with their cells', () => {
    const { container } = render(CornerGridHarness, { corners: { fl: 1, fr: 2, rl: 3, rr: 4 } });
    const cells = [...container.querySelectorAll('[data-corner]')];
    expect(cells.map((c) => c.getAttribute('data-corner'))).toEqual(['fl', 'fr', 'rl', 'rr']);
    expect(cells.map((c) => c.textContent?.trim())).toEqual(['fl=1', 'fr=2', 'rl=3', 'rr=4']);
  });
});

describe('Bar', () => {
  const props = { min: 0, max: 100, cols: 10, role: 'text' as const };
  it('renders the computed cells in the role colour', () => {
    const { container } = render(Bar, { ...props, value: known(40, at), limit: 70 });
    const el = container.querySelector('.bar') as HTMLElement;
    expect(el.textContent).toBe(barCells({ value: known(40, at), min: 0, max: 100, cols: 10, limit: 70 }).text);
    expect(el.style.color).toBe(role('text'));
    expect(el.getAttribute('title')).toBeNull();
  });
  it('an unknown value is an empty bar with the reason on hover', () => {
    const { container } = render(Bar, { ...props, value: unknown('realism') });
    const el = container.querySelector('.bar') as HTMLElement;
    expect(el.textContent).toBe(barCells({ value: unknown('realism'), min: 0, max: 100, cols: 10 }).text);
    expect(el.getAttribute('title')).toBe(unknownReason.realism);
  });
});

describe('CompoundMark', () => {
  const mark = (compound: VisualCompound, age?: number) => {
    const { container } = render(CompoundMark, age === undefined ? { compound } : { compound, age });
    return container.querySelector('.compound') as HTMLElement;
  };
  it.each([
    ['soft', 'S', 'compoundSoft'],
    ['medium', 'M', 'compoundMedium'],
    ['hard', 'H', 'compoundHard'],
  ] as const)('%s is the letter %s in the %s role', (compound, letter, r) => {
    const el = mark(compound);
    expect(el.textContent?.trim()).toBe(letter);
    expect(el.style.color).toBe(role(r));
    cleanup();
  });
  it.each([
    ['inter', 'I'],
    ['wet', 'W'],
    ['superSoft', 'SS'],
    ['unknown', '?'],
  ] as const)('%s is %s in faint text', (compound, letter) => {
    const el = mark(compound);
    expect(el.textContent?.trim()).toBe(letter);
    expect(el.style.color).toBe(role('textFaint'));
    cleanup();
  });
  it('the age follows the letter directly', () => expect(mark('medium', 12).textContent?.trim()).toBe('M12'));
  it('age 0 is shown', () => expect(mark('hard', 0).textContent?.trim()).toBe('H0'));
});

describe('InsightLine', () => {
  const insight = (severity: Insight['severity']): Insight => ({
    key: 'k',
    severity,
    category: 'tyres',
    feedId: feedId('f1'),
    kind: 'someUnknownKind',
    params: { pct: 42 },
    raisedAt: 1000,
  });
  const line = (severity: Insight['severity'], acknowledged: boolean) => {
    const { container } = render(InsightLine, { insight: insight(severity), acknowledged });
    return container.querySelector('.insight-line') as HTMLElement;
  };
  it('shows the formatted insight', () => expect(line('critical', false).textContent).toContain(formatInsight(insight('critical'))));
  it.each([
    ['critical', 'critical'],
    ['advisory', 'warning'],
    ['info', 'textDim'],
  ] as const)('an unacknowledged %s insight uses %s', (severity, r) => {
    const el = line(severity, false);
    expect(el.style.color).toBe(role(r));
    expect(el.getAttribute('data-severity')).toBe(severity);
    cleanup();
  });
  it('an acknowledged insight is faint', () => expect(line('critical', true).style.color).toBe(role('textFaint')));
});
