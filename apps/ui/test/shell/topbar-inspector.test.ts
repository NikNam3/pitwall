// @vitest-environment jsdom
// Panel click opens the dev inspector (spec 8.2, Task 17 fix round 1). Contract:
//  - in a DEV build, once `dev.inspect` (Ctrl+I) switched inspection on, a click anywhere in a panel's content calls
//    `inspection.open(widget)` for that panel's widget; the shell then shows Inspector.svelte (lazy chunk) with
//    `widget` = that panel's widget name and `link` = that panel's own resolved link (its link group, not group 1);
//  - with inspection off a click does nothing inspector-related and sends no `linkGroup.set`.
// Inspector.svelte is replaced by a recording stub (a Svelte component is a function of (anchor, props)).
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { carId } from '@pitwall/domain';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, OPTIONS, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

type PanelViewLike = { render(content: HTMLElement, tab: HTMLElement, spec: { widget: string; options: Record<string, unknown>; linkGroup: number }, id: string): unknown };
type MountCall = [HTMLElement, unknown, unknown, unknown, PanelViewLike];
const mocks = vi.hoisted(() => ({ mountDock: vi.fn(), shown: [] as Array<{ widget: unknown; link: unknown }> }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));
vi.mock('../../src/shell/inspector/Inspector.svelte', () => ({
  default: (_anchor: unknown, props: { widget: unknown; link: unknown }) => {
    mocks.shown.push({ get widget() { return props.widget; }, get link() { return props.link; } });
  },
}));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

beforeEach(() => {
  mocks.mountDock.mockReset();
  mocks.shown.length = 0;
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() }));
  stubBrowser();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const group2 = { id: 2, primary: carId(44), compare: [], window: { kind: 'live' as const } };

const mount = async () => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race'], active: workbook() });
  await ctx.push('ui.linkGroups', [group1(), group2]);
  await ctx.push('session.info', { feedId: FEED, playerCar: carId(5), session: { updatedAt: 1 } });
  const view = (mocks.mountDock.mock.calls.at(-1) as unknown as MountCall)[4];
  const panel = (widget: string, linkGroup: number, id: string): HTMLElement => {
    const content = document.body.appendChild(document.createElement('div'));
    view.render(content, document.body.appendChild(document.createElement('div')), { widget, options: OPTIONS, linkGroup }, id);
    return (content.firstElementChild as HTMLElement | null) ?? content;
  };
  return { ctx, panel };
};
const emptyCatalogue = { widgets: [], topics: [], features: [] };

describe('panel click with inspection on', () => {
  it('opens the inspector for the clicked panel, with that panel\'s own link', async () => {
    const { ctx, panel } = await mount();
    const first = panel('probe', 2, 'p1');
    const second = panel('stale-probe', 1, 'p2');
    press('i', { ctrl: true });
    await tick();
    await fireEvent.click(first);
    await ctx.push('dev.catalogue', emptyCatalogue);
    await vi.waitFor(() => expect(mocks.shown.length).toBeGreaterThan(0));
    const open = mocks.shown.at(-1)!;
    expect(open.widget).toBe('probe');
    expect(open.link).toEqual({ group: 2, feedId: FEED, primary: carId(44), compare: [], window: { kind: 'live' } });

    await fireEvent.click(second);
    await tick();
    await vi.waitFor(() => expect(mocks.shown.at(-1)!.widget).toBe('stale-probe'));
    expect(mocks.shown.at(-1)!.link).toMatchObject({ group: 1, primary: carId(5) });
  });

  it('a click does not send linkGroup.set', async () => {
    const { ctx, panel } = await mount();
    const el = panel('probe', 2, 'p1');
    press('i', { ctrl: true });
    await tick();
    await fireEvent.click(el);
    expect(ctx.linkSets()).toEqual([]);
  });
});

describe('panel click with inspection off', () => {
  it('shows no inspector, does not even ask for the catalogue, and sends no linkGroup.set', async () => {
    const { ctx, panel } = await mount();
    const el = panel('probe', 2, 'p1');
    await fireEvent.click(el);
    await tick();
    expect(mocks.shown).toEqual([]);
    expect(ctx.connection.subscribes().some((s) => s.topic === 'dev.catalogue')).toBe(false);
    expect(ctx.linkSets()).toEqual([]);
  });

  it('after Ctrl+I toggles it off again, a click opens nothing', async () => {
    const { panel } = await mount();
    const el = panel('probe', 2, 'p1');
    press('i', { ctrl: true });
    press('i', { ctrl: true });
    await tick();
    await fireEvent.click(el);
    await tick();
    expect(mocks.shown).toEqual([]);
  });
});
