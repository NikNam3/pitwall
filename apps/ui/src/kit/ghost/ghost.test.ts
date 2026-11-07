// @vitest-environment jsdom
// The ghost marker kit piece (SP4.2 spec §5, B1): one look for the rejoin ghost in the three ghost views (the crossing
// order's row, the gap chart's lines, the track map's ring), so no display styles the ghost itself (C68).
// Contract the tests assume:
//  - `kit/ghost/ghost.ts` exports `GHOST_DASH: Readonly<Record<PitCondition, readonly number[]>>` (the gap chart's
//    line dash per condition, in px) and `GHOST_ROLE = 'textFaint'` (the one role every ghost is drawn in);
//  - `kit/text.ts` exports `ghostLetter(c: PitCondition): string`, the condition's letter at a ghost line's end and
//    beside a map ring;
//  - `kit/ghost/GhostRow.svelte` takes `{ children: Snippet }` and renders, in order, a hairline, the row holding its
//    children, a hairline: each hairline an element with `data-hairline`, inline `height: 1px` and inline
//    `background-color` the `textFaint` role; the row an element with `data-ghost-row` and inline `color` the
//    `textFaint` role;
//  - `kit/track/ghost-ring.ts` exports `drawGhostRing(ctx, point, letter | undefined, roles)`, `point` in CSS px,
//    `roles(r: Role): string` resolving a role (as the canvas' `DrawApi.role`): one `arc` centred at the point, stroked
//    in the `textFaint` role, never filled (no `fill` or `fillRect`); the letter, when given, written with `fillText`
//    in the `textFaint` role; no letter writes no text.
import type { PitCondition } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { role } from '../../theme/index.ts';
import type { Role } from '../../theme/index.ts';
import { ghostLetter } from '../text.ts';
import { drawGhostRing } from '../track/ghost-ring.ts';
import { GHOST_DASH, GHOST_ROLE } from './ghost.ts';
import GhostRow from './GhostRow.svelte';

afterEach(cleanup);

const CONDITIONS: PitCondition[] = ['green', 'vsc', 'sc'];

describe('the ghost dash patterns', () => {
  it.each([
    ['green', [2, 3]],
    ['vsc', [7, 3]],
    ['sc', [7, 3, 2, 3]],
  ] as const)('%s is dashed %j', (c, dash) => {
    expect(GHOST_DASH[c]).toEqual(dash);
  });

  it('has a pattern for every condition and no other', () => {
    expect(Object.keys(GHOST_DASH).sort()).toEqual([...CONDITIONS].sort());
  });
});

describe('the ghost letters', () => {
  it.each([
    ['green', 'G'],
    ['vsc', 'VSC'],
    ['sc', 'SC'],
  ] as const)('%s is %s', (c, letter) => {
    expect(ghostLetter(c)).toBe(letter);
  });
});

describe('the ghost role', () => {
  it('is the faint text role', () => {
    expect(GHOST_ROLE).toBe('textFaint');
  });
});

describe('GhostRow', () => {
  const children = createRawSnippet(() => ({ render: () => '<span class="cells">P7 KUH +1.204</span>' }));
  const draw = (): HTMLElement => render(GhostRow, { props: { children } }).container;

  it('renders the row between two 1 px faint hairlines', () => {
    const c = draw();
    const parts = [...c.querySelectorAll<HTMLElement>('[data-hairline], [data-ghost-row]')];
    expect(parts.map((e) => (e.hasAttribute('data-ghost-row') ? 'row' : 'hairline'))).toEqual(['hairline', 'row', 'hairline']);
    for (const line of parts.filter((e) => e.hasAttribute('data-hairline'))) {
      expect(line.style.height).toBe('1px');
      expect(line.style.backgroundColor).toBe(role('textFaint'));
    }
  });

  it('renders its children inside the row, in the faint role', () => {
    const row = draw().querySelector<HTMLElement>('[data-ghost-row]');
    expect(row?.querySelector('.cells')?.textContent).toBe('P7 KUH +1.204');
    expect(row?.style.color).toBe(role('textFaint'));
  });
});

describe('drawGhostRing', () => {
  type Op = { op: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown };

  /** A 2D context that records every method call with the fill and stroke style at call time. */
  function recording(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
    const ops: Op[] = [];
    const state: Record<string | symbol, unknown> = {
      fillStyle: 'unset', strokeStyle: 'unset', lineWidth: 1, font: '10px sans-serif',
      textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1,
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args: unknown[]) => {
          ops.push({ op: String(key), args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle });
        };
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
  }

  /** A distinct value per role. */
  const roles = (r: Role): string => `resolved:${r}`;
  const point = { x: 120, y: 80 };

  it('strokes one ring centred at the point in the faint role', () => {
    const { ctx, ops } = recording();
    drawGhostRing(ctx, point, 'VSC', roles);
    const arcs = ops.filter((o) => o.op === 'arc');
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.args.slice(0, 2)).toEqual([120, 80]);
    const strokes = ops.filter((o) => o.op === 'stroke');
    expect(strokes.length).toBeGreaterThan(0);
    for (const s of strokes) expect(s.strokeStyle).toBe(roles('textFaint'));
  });

  it.each([['VSC'], [undefined]] as const)('draws no fill (letter %s)', (letter) => {
    const { ctx, ops } = recording();
    drawGhostRing(ctx, point, letter, roles);
    expect(ops.filter((o) => o.op === 'fill' || o.op === 'fillRect')).toEqual([]);
  });

  it('writes its letter in the faint role', () => {
    const { ctx, ops } = recording();
    drawGhostRing(ctx, point, 'SC', roles);
    const texts = ops.filter((o) => o.op === 'fillText');
    expect(texts.map((t) => t.args[0])).toEqual(['SC']);
    expect(texts[0]?.fillStyle).toBe(roles('textFaint'));
  });

  it('writes no text without a letter', () => {
    const { ctx, ops } = recording();
    drawGhostRing(ctx, point, undefined, roles);
    expect(ops.filter((o) => o.op === 'fillText' || o.op === 'strokeText')).toEqual([]);
  });
});
