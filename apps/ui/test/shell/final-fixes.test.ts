// @vitest-environment jsdom
// Final fix wave (B-I3): `window.focus.<id>` goes through `Host.focusWindow(id)`; the shell never calls the global focus() itself.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, GEO, OPTIONS, group1, makeStore, press, stubBrowser } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

beforeEach(() => {
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() }));
  stubBrowser();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const win = (id: string) => ({ id, geometry: GEO, layout: {}, panels: { p1: { widget: 'probe', options: OPTIONS, linkGroup: 1 } } });

describe('window.focus.<id>', () => {
  it('asks the host to focus that window and calls no global focus()', async () => {
    const ctx = makeStore();
    const globalFocus = vi.spyOn(globalThis, 'focus').mockImplementation(() => {});
    const windowFocus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
    await ctx.push('ui.workbooks', { names: ['race'], active: { name: 'race', windows: [win('main'), win('car')] } });
    await ctx.push('ui.linkGroups', [group1()]);
    press('k', { ctrl: true });
    await tick();
    const box = screen.getByRole('textbox');
    await fireEvent.input(box, { target: { value: 'Focus window car' } });
    await fireEvent.keyDown(box, { key: 'Enter' });
    await tick();
    expect(ctx.host.focusWindow).toHaveBeenCalledExactlyOnceWith('car');
    expect(globalFocus).not.toHaveBeenCalled();
    expect(windowFocus).not.toHaveBeenCalled();
  });
});
