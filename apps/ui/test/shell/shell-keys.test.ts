// @vitest-environment jsdom
// The shell's key listener and the font commands (spec 7.7, Task 16 requirement 1 and the default commands).
// Contract assumed:
//  - WindowShell registers ONE `keydown` listener on `window` (no other component adds one) and runs the command bound
//    to the pressed key, using the default bindings when `ui.settings` has no key file;
//  - while the event target is an <input>/<textarea>, only Escape is handled;
//  - keys are matched as `Ctrl+K` (event.key + ctrlKey): Ctrl+K opens the palette (a role=textbox appears), Escape runs
//    linkGroup.1.resetPrimary (sends linkGroup.set with primary 'player'), Ctrl+= / Ctrl+- / Ctrl+0 are window.fontBigger /
//    fontSmaller / fontReset;
//  - a font command sends (debounced like every window change) one workbook.updateWindow whose `fontPx` is the new size,
//    1 px steps clamped to 11..20, reset = the theme default; at a limit nothing is sent. The shell reads the size back
//    from the bridge's ui.workbooks, so the tests echo each saved size as an update.
import { cleanup, render, screen } from '@testing-library/svelte';
import { carId } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME } from '../../src/theme/index.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), destroy: vi.fn() }));
  stubBrowser();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = async (fontPx?: number, group = group1()) => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race'], active: workbook(fontPx) });
  await ctx.push('ui.linkGroups', [group]);
  await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), session: { updatedAt: 1 } });
  return ctx;
};
/** Presses, lets the debounce run, and returns the fontPx of every update sent so far. */
const sizes = async (ctx: Awaited<ReturnType<typeof mount>>) => {
  await vi.advanceTimersByTimeAsync(1000);
  return ctx.updates().map((w) => w.fontPx);
};
const echo = (ctx: Awaited<ReturnType<typeof mount>>, fontPx: number) => ctx.push('ui.workbooks', { names: ['race'], active: workbook(fontPx) }, 'update');

describe('the key listener', () => {
  it('the shell adds exactly one keydown listener on window, also after a panel is mounted and the palette is open', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const ctx = await mount(16);
    press('k', { ctrl: true });
    await tick();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    expect(ctx).toBeDefined();
  });

  it('a keydown on window runs the bound command: Ctrl+K opens the palette', async () => {
    await mount(16);
    expect(screen.queryByRole('textbox')).toBeNull();
    press('k', { ctrl: true });
    await tick();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('Escape runs linkGroup.1.resetPrimary: the primary goes back to the player', async () => {
    const ctx = await mount(16, group1({ primary: carId(44) }));
    press('Escape');
    await tick();
    expect(ctx.linkSets()).toHaveLength(1);
    expect(ctx.linkSets()[0]).toMatchObject({ id: 1, primary: 'player' });
  });

  it('while focus is in an input, Ctrl+K does nothing', async () => {
    await mount(16);
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    press('k', { ctrl: true }, input);
    await tick();
    expect(screen.getAllByRole('textbox')).toHaveLength(1); // only our own input, no palette
  });

  it('while focus is in an input, Escape is still handled', async () => {
    const ctx = await mount(16, group1({ primary: carId(44) }));
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
    press('Escape', {}, input);
    await tick();
    expect(ctx.linkSets()).toHaveLength(1);
    expect(ctx.linkSets()[0]).toMatchObject({ primary: 'player' });
  });
});

describe('font commands (window.fontBigger / fontSmaller / fontReset)', () => {
  it('Ctrl+= makes the font 1 px bigger: one updateWindow with the new fontPx and the rest of the window intact', async () => {
    const ctx = await mount(16);
    press('=', { ctrl: true });
    expect(await sizes(ctx)).toEqual([17]);
    expect(ctx.updates()[0]).toMatchObject({ id: 'main', layout: {}, panels: { p1: { widget: 'probe' } } });
  });

  it('Ctrl+- makes it 1 px smaller', async () => {
    const ctx = await mount(16);
    press('-', { ctrl: true });
    expect(await sizes(ctx)).toEqual([15]);
  });

  it('steps add up once the bridge has echoed the saved size', async () => {
    const ctx = await mount(16);
    press('=', { ctrl: true });
    await sizes(ctx);
    await echo(ctx, 17);
    press('=', { ctrl: true });
    expect(await sizes(ctx)).toEqual([17, 18]);
  });

  it('Ctrl+0 resets to the theme default', async () => {
    const ctx = await mount(18);
    press('0', { ctrl: true });
    expect(await sizes(ctx)).toEqual([DEFAULT_THEME.fontPx]);
  });

  it('is clamped at 20 px: bigger at 20 sends no update', async () => {
    const ctx = await mount(20);
    press('=', { ctrl: true });
    expect(await sizes(ctx)).toEqual([]);
  });

  it('is clamped at 11 px: smaller at 11 sends no update', async () => {
    const ctx = await mount(11);
    press('-', { ctrl: true });
    expect(await sizes(ctx)).toEqual([]);
  });

  it('a window without a saved size starts from the theme default', async () => {
    const ctx = await mount(undefined);
    press('=', { ctrl: true });
    expect(await sizes(ctx)).toEqual([DEFAULT_THEME.fontPx + 1]);
  });
});
