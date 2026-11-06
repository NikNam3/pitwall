// @vitest-environment jsdom
// The raising average as drawn (spec 4, plan Task 9; C65): the kit chart with the lines of `rows.ts`. Contract assumed of
// `RaisingAverageChart.svelte` (props `WidgetProps<typeof widget>`):
//  - with at least one line: the kit chart (a canvas), full and compact;
//  - without a line (every curve empty): no chart, the kit's `no data yet` in an element of class `line`, textDim;
//  - fit (jsdom): the chart's canvas no taller and no wider than the panel.
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { cellBox } from '../../kit/size/size.ts';
import { noDataYet } from '../../kit/text.ts';
import { DEFAULT_THEME, role } from '../../theme/index.ts';
import { cases, raceOptions } from './fixtures.ts';
import RaisingAverageChart from './RaisingAverageChart.svelte';

const box = cellBox(DEFAULT_THEME.fontPx, DEFAULT_THEME.density.lineHeight);
type Size = { mode: 'compact' | 'full'; cols: number; rows: number };
const sizeOf = (s: Size) => ({ ...s, px: { width: s.cols * box.width, height: s.rows * box.height }, dpr: 1 });
const FULL: Size = { mode: 'full', cols: 60, rows: 14 };
const COMPACT: Size = { mode: 'compact', cols: 36, rows: 8 };

// The kit chart measures its box with a ResizeObserver: report the size under test.
let observed = { width: 0, height: 0 };
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: observed }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type CaseName = keyof typeof cases;
const NONE = { rival1: undefined, rival2: undefined, rival3: undefined };

/** Renders a case at a size with the given options and lets the chart draw (its effects run on later microtasks). */
async function show(name: CaseName, size: Size, options: Record<string, unknown> = NONE): Promise<HTMLElement> {
  const widgetSize = sizeOf(size);
  observed = widgetSize.px;
  const { container } = render(InPanel, {
    component: RaisingAverageChart as unknown as Component<Record<string, unknown>>,
    widgetProps: { data: { ...cases[name] }, options, size: widgetSize, link: {} },
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  container.querySelector('[data-testid="stale-for"]')?.remove();
  return container;
}

const textOf = (e: Element): string => (e.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('RaisingAverageChart', () => {
  it.each([FULL, COMPACT])('1. draws the kit chart for the race case with the mockup\'s rivals ($mode)', async (size) => {
    expect((await show('race', size, raceOptions)).querySelector('canvas')).not.toBeNull();
  });

  it('2. draws the kit chart for the practice case with one car', async () => {
    expect((await show('practiceOneCar', FULL)).querySelector('canvas')).not.toBeNull();
  });

  it.each([FULL, COMPACT])('3. shows no data yet and no chart when no car has a lap ($mode)', async (size) => {
    const c = await show('noLaps', size, raceOptions);
    expect(c.querySelector('canvas')).toBeNull();
    const line = c.querySelector<HTMLElement>('.line');
    expect(line && textOf(line)).toBe(noDataYet);
    expect(line?.style.color).toBe(role('textDim'));
  });

});

describe('RaisingAverageChart: every case fits its sizes', () => {
  // The mode minimums and the gallery's other fit sizes (gallery.ts lists the same).
  const SIZES: Size[] = [COMPACT, { mode: 'compact', cols: 59, rows: 13 }, FULL, { mode: 'full', cols: 90, rows: 20 }];
  const rows = (Object.keys(cases) as CaseName[]).flatMap((name) => SIZES.map((size) => [name, `${size.mode} ${size.cols}x${size.rows}`, size] as const));

  it.each(rows)('4. %s at %s', async (name, _at, size) => {
    const c = await show(name, size, raceOptions);
    const px = sizeOf(size).px;
    const lines = [...c.querySelectorAll<HTMLElement>('.line')];
    expect(lines.filter((l) => [...(l.textContent ?? '')].length > size.cols).map((l) => l.textContent)).toEqual([]);
    const chartHeight = Math.max(0, ...[...c.querySelectorAll('canvas')].map((cv) => cv.height));
    for (const cv of c.querySelectorAll('canvas')) expect(cv.width).toBeLessThanOrEqual(Math.ceil(px.width));
    expect(chartHeight + lines.length * box.height).toBeLessThanOrEqual(Math.ceil(px.height));
  });
});
