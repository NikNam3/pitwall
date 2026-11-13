// @vitest-environment jsdom
// The drivers-panel gallery (plan SP4.3b2 Task 16 row 9; P17, C65, C73): its cases are the data states of the mockup
// docs/design/2026-11-12-sp4.3b/drivers-panel.html (two seats at full and compact, compact with an unlinked seat) and the
// garage without a session; the person picker and the new-person field are window-local (DriversPanel.test.ts row 1).
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import DriversPanel from './DriversPanel.svelte';
import { cases, fit } from './fixtures.ts';
import { widget } from './widget.ts';

afterEach(cleanup);

describe('drivers-panel gallery', () => {
  it('gallery: the data states of drivers-panel.html (two seats, compact, compact with an unlinked seat)', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 30, minRows: 3 }, full: { minCols: 92, minRows: 36 } });
    // the first case is the baseline (Task 18), a pure data state: both seats linked, a session and a config
    expect(Object.keys(cases)[0]).toBe('twoSeats');
    expect(Object.keys(cases)).toEqual(expect.arrayContaining(['twoSeats', 'unlinkedSeat', 'noSession']));
    for (const [mode, s] of Object.entries(widget.sizes)) expect(fit, mode).toContainEqual({ mode, cols: s.minCols, rows: s.minRows });
    // every case renders at every fit size
    for (const [name, data] of Object.entries(cases)) {
      for (const size of fit) {
        const { container } = render(ActionsHarness, {
          send: () => Promise.resolve({ ok: true }),
          actions: widget.actions,
          component: DriversPanel as unknown as Component<Record<string, unknown>>,
          widgetProps: { data, options: {}, size: { ...size, px: { width: size.cols * 8, height: size.rows * 16 }, dpr: 1 }, link: {} },
        });
        expect(container.textContent, `${name} ${size.mode} ${size.cols}×${size.rows}`).toContain('#12');
        cleanup();
      }
    }
  });
});
