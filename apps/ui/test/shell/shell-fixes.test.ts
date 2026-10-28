// @vitest-environment jsdom
// Task 16 fix round 1: identical panels keep separate settings; the window measures cells with the active theme.
// Contract assumed:
//  - PanelView.render gets the panel id as its 4th argument: render(content, tab, spec, panelId); the shell looks the
//    panel up by that id, never by comparing specs (two panels with equal specs are two panels);
//  - theme.<name> switches the theme at runtime: the window measures cells with that theme's density.lineHeight and
//    window.fontReset resets to that theme's fontPx (a variant with another fontPx is pushed into THEMES for the test);
//  - the palette runs a command on Enter in its input.
import type { Workbook } from '@pitwall/contracts';
import { carId } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { DEFAULT_THEME, THEMES, applyTheme } from '../../src/theme/index.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, GEO, OPTIONS, group1, makeStore, press, stubBrowser } from './shell-harness.ts';

type Spec = { widget: string; options: Record<string, unknown>; linkGroup: number };
type MountCall = [HTMLElement, unknown, unknown, unknown, { render(c: HTMLElement, t: HTMLElement, s: Spec, id: string): unknown }];
const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

const BIG = { ...DEFAULT_THEME, name: 'test-big', fontPx: 18 };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), destroy: vi.fn() }));
  stubBrowser();
  THEMES.push(BIG);
});
afterEach(() => {
  cleanup();
  THEMES.splice(THEMES.indexOf(BIG), 1);
  applyTheme(DEFAULT_THEME, document.documentElement);
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = () => vi.advanceTimersByTimeAsync(300);
const book = (panels: Record<string, Spec>, fontPx = 16): Workbook => ({
  name: 'race',
  windows: [{ id: 'main', geometry: GEO, fontPx, layout: {}, panels }],
});
const mount = async (panels: Record<string, Spec>) => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race'], active: book(panels) });
  await ctx.push('ui.linkGroups', [group1()]);
  const view = (mocks.mountDock.mock.calls.at(-1) as unknown as MountCall)[4];
  const panel = (id: string) => {
    const content = document.body.appendChild(document.createElement('div'));
    const tab = document.body.appendChild(document.createElement('div'));
    view.render(content, tab, panels[id]!, id);
    return { content, tab };
  };
  const feedStatus = async () => {
    for (const s of ctx.connection.subscribes().filter((x) => x.topic === 'feed.status'))
      ctx.connection.push({ type: 'snapshot', id: s.id, value: { feedId: FEED, connected: true, stale: false } });
    await settle();
  };
  const session = () => ctx.push('session.info', { feedId: FEED, playerCar: carId(5), session: { updatedAt: 1 } });
  return { ...ctx, panel, feedStatus, session };
};
const probe: Spec = { widget: 'probe', options: OPTIONS, linkGroup: 1 };

describe('two panels from the same widget with identical specs', () => {
  it('changing an option through the second panel\'s gear updates only the second panel\'s options', async () => {
    const ctx = await mount({ p1: { ...probe }, p2: { ...probe, options: { ...OPTIONS } } });
    const first = ctx.panel('p1');
    const second = ctx.panel('p2');
    await ctx.session();
    await fireEvent.click(within(second.tab).getByRole('img', { name: text.settings }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Flag' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]!.panels.p1).toEqual({ ...probe });
    expect(ctx.updates()[0]!.panels.p2).toEqual({ ...probe, options: { ...OPTIONS, flag: true } });
    await ctx.feedStatus();
    const shown = (c: HTMLElement) => vi.waitFor(() => JSON.parse(within(c).getByTestId('options').textContent!));
    expect(await shown(first.content)).toEqual(OPTIONS);
    expect(await shown(second.content)).toEqual({ ...OPTIONS, flag: true });
  });

  it('and through the first panel\'s gear updates only the first', async () => {
    const ctx = await mount({ p1: { ...probe }, p2: { ...probe, options: { ...OPTIONS } } });
    const first = ctx.panel('p1');
    ctx.panel('p2');
    await ctx.session();
    await fireEvent.click(within(first.tab).getByRole('img', { name: text.settings }));
    await fireEvent.click(screen.getByRole('radio', { name: 'b' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()[0]!.panels.p1).toEqual({ ...probe, options: { ...OPTIONS, mode: 'b' } });
    expect(ctx.updates()[0]!.panels.p2).toEqual({ ...probe });
  });
});

describe('theme variants at runtime', () => {
  const runTheme = async (name: string) => {
    press('k', { ctrl: true });
    await settle();
    const box = screen.getByRole('textbox');
    await fireEvent.input(box, { target: { value: name } });
    await fireEvent.keyDown(box, { key: 'Enter' });
    await settle();
  };

  it('after theme.quiet-roomy the window measures cells with line height 1.6', async () => {
    const ctx = await mount({ s1: { widget: 'size-probe', options: {}, linkGroup: 1 } });
    const { content } = ctx.panel('s1');
    await ctx.session();
    await ctx.feedStatus();
    // 600 x 400 px body, font 16 px, line height 1.4 -> rows = floor(400 / 22.4) = 17
    await vi.waitFor(() => expect(within(content).getByTestId('cells').textContent).toBe('62x17')); // the component loads lazily
    await runTheme('quiet-roomy');
    // line height 1.6 -> rows = floor(400 / 25.6) = 15
    await vi.waitFor(() => expect(within(content).getByTestId('cells').textContent).toBe('62x15'));
  });

  it('window.fontReset resets to the active theme\'s fontPx', async () => {
    const ctx = await mount({ p1: { ...probe } });
    ctx.panel('p1');
    await ctx.session();
    await runTheme('test-big');
    press('0', { ctrl: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates().map((w) => w.fontPx)).toEqual([18]);
  });
});
