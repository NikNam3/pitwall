// @vitest-environment jsdom
// The kit `PositionMark` (spec A.4; review 6, R6-3). Contract assumed of kit/values/PositionMark.svelte, props
// `PositionMarkProps`:
//  - its text is `positionMarkText(props)`;
//  - the pair form shows an unknown target the kit's one way (`unknownShown`): the reason's mark in the faint role, the
//    reason's hover text as the title of the element that holds the mark; a known pair has no hover.
import { cleanup, render } from '@testing-library/svelte';
import { known, unknown, type SessionTime, type UnknownReason } from '@pitwall/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownMark, unknownReason } from '../../src/kit/text.ts';
import PositionMark from '../../src/kit/values/PositionMark.svelte';
import { positionMarkText, type PositionMarkProps } from '../../src/kit/values/position-mark.ts';
import { role } from '../../src/theme/index.ts';

afterEach(cleanup);

const REASONS = Object.keys(unknownReason) as UnknownReason[];
const mark = (props: PositionMarkProps): HTMLElement => render(PositionMark, { props }).container;
const titled = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('[title]')];

describe('PositionMark', () => {
  it('shows places gained or lost as its text', () => {
    expect(mark({ change: 2 }).textContent).toBe(positionMarkText({ change: 2 }));
    expect(mark({ change: -1 }).textContent).toBe(positionMarkText({ change: -1 }));
  });

  it('shows a known pair as its text, with no hover', () => {
    const c = mark({ from: 7, to: known(9, 0 as SessionTime) });
    expect(c.textContent).toBe('P7→P9');
    expect(titled(c)).toEqual([]);
  });

  it.each(REASONS)('an unknown target (%s) shows its mark faint, with the reason on hover', (reason) => {
    const props: PositionMarkProps = { from: 7, to: unknown(reason) };
    const c = mark(props);
    expect(c.textContent).toBe(positionMarkText(props));
    const [hover, ...more] = titled(c);
    expect(more).toEqual([]);
    expect(hover?.title).toBe(unknownReason[reason]);
    expect(hover?.textContent?.trim()).toBe(unknownMark[reason]);
    expect(hover?.style.color).toBe(role('textFaint'));
  });
});
