// @vitest-environment jsdom
// SettingsPopover (spec 7.4, Task 16): built from the widget's `options` declaration, opened by the gear in the panel header.
// Contract assumed:
//  - clicking the gear (the element with the accessible name `text.settings`) opens the popover, anywhere in the document;
//  - a bool option is a checkbox named by its label ('Flag'); a choice option is a radio group with one radio per choice,
//    named by the choice ('a', 'b'); a number option is a spinbutton named by its label ('Count');
//  - changing a value sends (debounced like every window change) ONE workbook.updateWindow carrying the whole window, in
//    which the panel's `options` (all of them) hold the new value and the rest of the panel spec is unchanged.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { carId } from '@pitwall/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import type { Workbook } from '@pitwall/contracts';
import carOptionProbe from './fixtures/car-option-probe/register.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, GEO, OPTIONS, group1, makeStore, stubBrowser, workbook } from './shell-harness.ts';

type MountCall = [HTMLElement, unknown, unknown, unknown, { render(c: HTMLElement, t: HTMLElement, s: { widget: string; options: Record<string, unknown>; linkGroup: number }, id: string): unknown }];
const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() }));
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
  view.render(document.body.appendChild(document.createElement('div')), tab, { widget: 'probe', options: OPTIONS, linkGroup: 1 }, 'p1');
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

// Final fix wave (B-I2): the popover chooses the panel's link group (1 to 4).
// Contract assumed: a radio group named `text.linkGroup` (new key in kit/text.ts, 'Link group') with radios named '1'..'4';
// choosing one sends ONE workbook.updateWindow in which only that panel's `linkGroup` changed (options and widget unchanged).
describe('SettingsPopover: link group choice', () => {
  it('offers groups 1 to 4 with the panel\'s current group checked', async () => {
    await open();
    const group = screen.getByRole('radiogroup', { name: text.linkGroup });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.getAttribute('aria-label') ?? r.labels?.[0]?.textContent?.trim())).toEqual(['1', '2', '3', '4']);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false]);
  });

  it('choosing group 3 sends one updateWindow with linkGroup 3 and the options untouched', async () => {
    const ctx = await open();
    const group = screen.getByRole('radiogroup', { name: text.linkGroup });
    await fireEvent.click(within(group).getByRole('radio', { name: '3' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]!.panels.p1).toEqual({ widget: 'probe', options: OPTIONS, linkGroup: 3 });
  });
});

// SP4.1b Task 9a: a car option's choices. Contract assumed:
//  - a car option is a <select> named by its label ('Rival 1' of the none variant, 'Car' of the default follow variant);
//  - its first choice reads `none` (unset: 'none') or `follow` (`text.followLink`, unset: 'follow'), and choosing it removes
//    the option from the panel's options; then `text.picker.player`, `text.picker.teammate`;
//  - then every car of the feed's `cars.overview` by its three-letter code (value: the car id), the current one selected;
//  - while `cars.overview` has no value, the current car number is still listed, selected.
describe('SettingsPopover: car options', () => {
  const carWorkbook = (options: Record<string, unknown>): Workbook => ({
    name: 'race',
    windows: [{ id: 'main', geometry: GEO, layout: {}, panels: { p1: { widget: 'car-option-probe', options, linkGroup: 1 } } }],
  });
  const overview = [
    { id: carId(1), identity: { name: 'Max Verstappen', raceNumber: 1 } },
    { id: carId(3), identity: { name: 'Charles Leclerc', raceNumber: 16 } },
    { id: carId(7), identity: { name: 'Lewis Hamilton', raceNumber: 44 } },
  ];
  const openCars = async (options: Record<string, unknown>, cars?: unknown) => {
    const ctx = makeStore();
    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: [...TEST_WIDGETS, carOptionProbe], defaultFeed: FEED });
    await ctx.push('ui.workbooks', { names: ['race'], active: carWorkbook(options) });
    await ctx.push('ui.linkGroups', [group1()]);
    const view = (mocks.mountDock.mock.calls.at(-1) as unknown as MountCall)[4];
    const tab = document.body.appendChild(document.createElement('div'));
    view.render(document.body.appendChild(document.createElement('div')), tab, { widget: 'car-option-probe', options, linkGroup: 1 }, 'p1');
    await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), session: { updatedAt: 1 } });
    await fireEvent.click(screen.getByRole('img', { name: text.settings }));
    if (cars !== undefined) await ctx.push('cars.overview', cars);
    return ctx;
  };
  const select = (label: string): HTMLSelectElement => screen.getByRole('combobox', { name: label }) as HTMLSelectElement;
  const choices = (label: string): string[] => [...select(label).options].map((o) => o.textContent?.trim() ?? '');

  it("shows none first for the none variant and follow first for the default", async () => {
    await openCars({});
    expect(choices('Rival 1')[0]).toBe('none');
    expect(choices('Car')[0]).toBe(text.followLink);
    expect(select('Rival 1').selectedIndex).toBe(0);
    expect(select('Car').selectedIndex).toBe(0);
  });

  it("lists the codes of cars.overview's three cars after player and teammate, the current one selected", async () => {
    await openCars({ rival: carId(3) }, overview);
    await vi.waitFor(() => expect(choices('Rival 1')).toEqual(['none', text.picker.player, text.picker.teammate, 'VER', 'LEC', 'HAM']));
    const sel = select('Rival 1');
    expect([...sel.options].slice(3).map((o) => o.value)).toEqual(['1', '3', '7']);
    expect(sel.options[sel.selectedIndex]!.textContent?.trim()).toBe('LEC');
  });

  it("choosing a listed car sends that car id through onChange", async () => {
    const ctx = await openCars({}, overview);
    await vi.waitFor(() => expect(choices('Rival 1')).toContain('HAM'));
    await fireEvent.change(select('Rival 1'), { target: { value: '7' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]!.panels.p1).toEqual({ widget: 'car-option-probe', linkGroup: 1, options: { rival: 7 } });
  });

  it('choosing the first entry removes the option (unset)', async () => {
    const ctx = await openCars({ rival: carId(3), car: 'player' }, overview);
    await vi.waitFor(() => expect(choices('Rival 1')).toContain('LEC'));
    await fireEvent.change(select('Rival 1'), { target: { value: select('Rival 1').options[0]!.value } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.updates()).toHaveLength(1);
    expect(ctx.updates()[0]!.panels.p1).toEqual({ widget: 'car-option-probe', linkGroup: 1, options: { car: 'player' } });
  });

  it('without cars.overview the current number is still listed, selected', async () => {
    await openCars({ rival: carId(7) });
    expect(choices('Rival 1')).toEqual(['none', text.picker.player, text.picker.teammate, '7']);
    expect(select('Rival 1').value).toBe('7');
  });
});
