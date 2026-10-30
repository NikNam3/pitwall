// @vitest-environment jsdom
// The kit's one text cell (wave 2, T7; review-ui finding 7): a display hands it a pre-formatted text, or an unknown's
// reason, and the cell shows the text or the reason's mark. No display repeats the "unknown, then the mark" branch.
// Contract the tests assume of kit/values/TextCell.svelte:
//  - props `{ text: string; reason?: UnknownReason; width?: number; align?: 'left' | 'right'; role?: Role; title?: string }`,
//    `align` left by default;
//  - with `width`, a known text takes exactly `width` characters: padded on the side `align` names, or cut with `…`
//    (the kit `fitCell` rule); without `width` the text shows as given;
//  - a known text is in `role`'s colour (inline `color`) with `title` on hover;
//  - with `reason`, the cell shows the reason's mark (`unknownMark`) padded to `width` the same way, in the faint role,
//    with the reason's hover text (`unknownReason`) as its title: the role and title of a known text do not apply.
import { cleanup, render } from '@testing-library/svelte';
import type { UnknownReason } from '@pitwall/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { fitCell } from '../../src/kit/grid/grid.ts';
import { unknownMark, unknownReason } from '../../src/kit/text.ts';
import TextCell from '../../src/kit/values/TextCell.svelte';
import { role } from '../../src/theme/index.ts';

afterEach(cleanup);

type Props = { text: string; reason?: UnknownReason; width?: number; align?: 'left' | 'right'; role?: Parameters<typeof role>[0]; title?: string };
const cell = (props: Props): HTMLElement => render(TextCell, { props }).container;

/** The element that shows `text` itself (not only inside a child). */
const holding = (c: HTMLElement, text: string): HTMLElement | undefined =>
  [...c.querySelectorAll<HTMLElement>('*')].find((e) => e.textContent?.trim() === text && ![...e.children].some((k) => k.textContent?.trim() === text));

describe('TextCell: a known text', () => {
  it('takes exactly its width: padded on the side it is aligned to', () => {
    expect(cell({ text: '1:23.4', width: 8, align: 'right' }).textContent).toBe('  1:23.4');
    expect(cell({ text: 'OCO', width: 5, align: 'left' }).textContent).toBe('OCO  ');
  });

  it('is left aligned by default', () => {
    expect(cell({ text: 'OCO', width: 5 }).textContent).toBe('OCO  ');
  });

  it('is cut with the kit cut marker when it does not fit', () => {
    expect(cell({ text: 'drive-through', width: 8 }).textContent).toBe(fitCell('drive-through', 8));
    expect(cell({ text: 'drive-through', width: 8 }).textContent).toBe('drive-t…');
  });

  it('shows as given without a width', () => {
    expect(cell({ text: '+0.4 MJ/lap' }).textContent).toBe('+0.4 MJ/lap');
  });

  it("shows in its role's colour, with its title on hover", () => {
    const c = cell({ text: '5s', width: 3, align: 'right', role: 'warning', title: 'drive-through to serve' });
    expect(holding(c, '5s')?.style.color).toBe(role('warning'));
    expect(c.querySelector('[title]')?.getAttribute('title')).toBe('drive-through to serve');
  });

  it('has no hover and no colour of its own without a title or role', () => {
    const c = cell({ text: '12%', width: 3 });
    expect(c.querySelector('[title]')).toBeNull();
    expect(holding(c, '12%')?.style.color ?? '').toBe('');
  });
});

describe('TextCell: an unknown value', () => {
  it.each(['realism', 'restricted', 'notReceived', 'notApplicable', 'insufficientData'] as const)(
    "%s: the reason's mark, padded to the width, in the faint role, the reason on hover",
    (reason) => {
      const c = cell({ text: '', reason, width: 6, align: 'right' });
      expect(c.textContent).toBe(unknownMark[reason].padStart(6));
      const mark = holding(c, unknownMark[reason]);
      expect(mark?.style.color).toBe(role('textFaint'));
      expect(mark?.closest('[title]')?.getAttribute('title')).toBe(unknownReason[reason]);
    },
  );

  it('pads a left-aligned mark at its end', () => {
    expect(cell({ text: '', reason: 'notReceived', width: 4 }).textContent).toBe(`${unknownMark.notReceived}   `);
  });

  it('is the mark alone without a width', () => {
    expect(cell({ text: '', reason: 'realism' }).textContent).toBe(unknownMark.realism);
  });

  it("is faint with the reason's hover whatever role and title a known text would have", () => {
    const c = cell({ text: '', reason: 'realism', width: 3, role: 'warning', title: 'drive-through to serve' });
    const mark = holding(c, unknownMark.realism);
    expect(mark?.style.color).toBe(role('textFaint'));
    expect(mark?.closest('[title]')?.getAttribute('title')).toBe(unknownReason.realism);
    expect(c.textContent).not.toContain('drive-through');
  });
});
