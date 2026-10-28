// @vitest-environment jsdom
// SettingsPopover (spec 7.4, Task 16): built from the widget's `options` declaration, opened by the gear in the panel header.
// Contract assumed:
//  - clicking the gear (the element with the accessible name `text.settings`) opens the popover, anywhere in the document;
//  - a bool option is a checkbox named by its label ('Flag'); a choice option is a radio group with one radio per choice,
//    named by the choice ('a', 'b'); a number option is a spinbutton named by its label ('Count');
//  - changing a value sends (debounced like every window change) ONE workbook.updateWindow carrying the whole window, in
//    which the panel's `options` (all of them) hold the new value and the rest of the panel spec is unchanged.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { carId } from '@pitwall/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, OPTIONS, group1, makeStore, stubBrowser, workbook } from './shell-harness.ts';

type MountCall = [HTMLElement, unknown, unknown, unknown, { render(c: HTMLElement, t: HTMLElement, s: { widget: string; options: Record<string, unknown>; linkGroup: number }): unknown }];
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
});

const open = async () => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
  await ctx.push('ui.linkGroups', [group1()]);
  const view = (mocks.mountDock.mock.calls.at(-1) as unknown as MountCall)[4];
  const tab = document.body.appendChild(document.createElement('div'));
  view.render(document.body.appendChild(document.createElement('div')), tab, { widget: 'probe', options: OPTIONS, linkGroup: 1 });
  await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), session: { updatedAt: 1 } });
  await fireEvent.click(screen.getByRole('img', { name: text.settings }));
  return ctx;
};

describe('SettingsPopover', () => {
  it('shows a control per declared option, with the current values', async () => {
    await open();
    expect((screen.getByRole('checkbox', { name: 'Flag' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('radio', { name: 'a' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'b' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('spinbutton', { name: 'Count' }) as HTMLInputElement).value).toBe('3');
  });

  it('toggling the bool option sends one updateWindow with the panel\'s updated options', async () => {
    const ctx = await open();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Flag' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]).toMatchObject({ id: 'main', fontPx: 16, panels: { p1: { widget: 'probe', linkGroup: 1, options: { mode: 'a', count: 3, flag: true } } } });
  });

  it('picking another choice sends one updateWindow with the panel\'s updated options', async () => {
    const ctx = await open();
    await fireEvent.click(screen.getByRole('radio', { name: 'b' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]!.panels.p1).toEqual({ widget: 'probe', linkGroup: 1, options: { mode: 'b', count: 3, flag: false } });
  });
});
