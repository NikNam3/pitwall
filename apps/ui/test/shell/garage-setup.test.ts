// @vitest-environment jsdom
// SP4.3b2 Task 11 (spec §10 "Shell (U7)"; mockup docs/design/2026-11-12-sp4.3b/strategy-workbook.html, README Q6 A):
// garage setup without the session-start prompt, `calibration.pick` and `drivers.open`, the top bar's unlinked seats
// (C64, C67, C70, C72, C73, C74). Ports the commands and top-bar tests of the deleted calibration-prompt.test.ts (C82).
// Contract assumed of the shell (WindowShell.svelte with its dock mocked, as in topbar-commands.test.ts):
//  - `shell/calibration/Prompt.svelte`, the `calibration` overlay and the new-session auto-open are gone: no overlay opens
//    by itself when `calibration.active` names a new session;
//  - `calibrationCommands(sets, { send, feedId, ... })` has no `closePrompt`; `calibration.choose.<setId>` and
//    `calibration.choose.defaults` stay and send `uiAction { kind: 'calibration.choose', feedId: defaultFeed, setId }`;
//  - `calibration.pick` (and the new `drivers.open`) switch to the `garage` workbook the way every manual switch goes
//    (C67, C73: the uiAction `workbook.open { name: 'garage' }`, the window keeps no copy); none is sent while `garage` is
//    already the active workbook. Once the bridge publishes `garage` as active, the window holding a panel of the widget
//    `calibration-panel` (`drivers.open`: `drivers-panel`) focuses it through the dock: `DockHandle.focusPanel(panelId)`
//    (new), with the panel's id in the window's `panels`;
//  - the top-bar segment `unlinked` (`segments/Unlinked.svelte`, TOP_BAR.left right after `calibration`): a button
//    `unlinked-count` reading `unlinked <n>`, `n` = `drivers.links.unlinkedSeats.length` (global topic), the label in
//    the bar's `textDim`, the count in the `text` role; nothing at 0 or before `drivers.links` is known; a click invokes
//    `drivers.open` by id (`registry.run`).
import type { CalibrationActiveValue, CalibrationSet, CalibrationSetsValue, DriversLinksValue, LiveSeat } from '@pitwall/domain';
import type { Workbook } from '@pitwall/contracts';
import { carId, unknown } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import { role } from '../../src/theme/index.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, GEO, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

const SILVERSTONE = 7;
const MONZA = 11;

const set = (id: string, over: Partial<CalibrationSet> = {}): CalibrationSet => ({
  id,
  trackId: SILVERSTONE,
  name: id,
  createdAt: '2026-09-28',
  sources: [],
  overrides: {},
  preferred: false,
  ...over,
});
const SETS: CalibrationSetsValue = { sets: [set('league'), set('after-floor-upgrade'), set('monza-dry', { trackId: MONZA }), set('pre-season')] };
const TRACK_SET_IDS = ['league', 'after-floor-upgrade', 'pre-season'];

type Active = Extract<CalibrationActiveValue, { known: true }>['value'];
const active = (over: Partial<Active> = {}): CalibrationActiveValue => ({
  known: true,
  at: 0,
  value: { sessionUid: 's1', trackId: SILVERSTONE, setId: 'league', setName: 'league', snapshot: 'fp-league', picked: false, ...over },
});

/** The garage workbook: its calibration and drivers panels under ids other than their widget names. */
const GARAGE: Workbook = {
  name: 'garage',
  windows: [
    {
      id: 'main',
      geometry: GEO,
      layout: {},
      panels: {
        tower: { widget: 'probe', options: {}, linkGroup: 1 },
        cal: { widget: 'calibration-panel', options: {}, linkGroup: 1 },
        drv: { widget: 'drivers-panel', options: {}, linkGroup: 1 },
      },
    },
  ],
};

const seat = (n: number): LiveSeat => ({ feedId: FEED, carId: carId(n), team: 3, raceNumber: 40 + n });
const links = (unlinkedSeats: LiveSeat[]): DriversLinksValue => ({ links: [], unlinked: [], unlinkedSeats });

/** Watches `register` (it still registers); the shell's registry is the `this` of its first call. */
let registering: { mock: { contexts: unknown[] } } | undefined;
const shellRegistry = (): CommandRegistry => {
  const registry = registering?.mock.contexts[0] as CommandRegistry | undefined;
  if (registry === undefined) throw new Error('the shell registered no command');
  return registry;
};

type Handle = { addPanel: ReturnType<typeof vi.fn>; updatePanel: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; setEditing: ReturnType<typeof vi.fn>; focusPanel: ReturnType<typeof vi.fn> };
const handles: Handle[] = [];
/** The dock mounted last: the one showing the window's current workbook. */
const lastDock = (): Handle => {
  const h = handles.at(-1);
  if (h === undefined) throw new Error('no dock mounted');
  return h;
};

beforeEach(() => {
  handles.length = 0;
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => {
    const h: Handle = { addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn(), setEditing: vi.fn(), focusPanel: vi.fn() };
    handles.push(h);
    return h;
  });
  stubBrowser();
  registering = vi.spyOn(CommandRegistry.prototype, 'register');
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Setup = { active?: CalibrationActiveValue; book?: Workbook; links?: DriversLinksValue | undefined };
const mount = async (setup: Setup = {}) => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race', 'garage'], active: setup.book ?? workbook(16) });
  await ctx.push('ui.linkGroups', [group1()]);
  await ctx.push('calibration.sets', SETS);
  await ctx.push('calibration.values', { bySet: {} });
  await ctx.push('calibration.active', setup.active ?? active());
  if (setup.links !== undefined) await ctx.push('drivers.links', setup.links);
  await tick();
  const actions = () => ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' ? [m.action] : []));
  const chosen = () => actions().filter((a) => a.kind === 'calibration.choose');
  const opened = () => actions().filter((a) => a.kind === 'workbook.open');
  return { ...ctx, actions, chosen, opened };
};

const segmentText = (el: Element | null): string | undefined => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('no session-start prompt (U7)', () => {
  it('no overlay at a new session', async () => {
    const t = await mount();
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.queryByTestId('calibration-prompt')).toBeNull();
    await t.push('calibration.active', active({ sessionUid: 's2' }));
    await tick();
    expect(screen.queryByTestId('overlay')).toBeNull();
    expect(screen.queryByTestId('calibration-prompt')).toBeNull();
  });
});

describe('calibration.pick and drivers.open (C67)', () => {
  it('calibration.pick switches to garage and focuses calibration-panel (through the layout controller)', async () => {
    const t = await mount();
    expect(shellRegistry().run('calibration.pick')).toBe(true);
    await tick();
    // The switch is the bridge's: one workbook.open, and nothing changes in the window until it publishes it (C73).
    expect(t.opened()).toEqual([{ kind: 'workbook.open', name: 'garage' }]);
    expect(screen.queryByTestId('overlay')).toBeNull();
    await t.push('ui.workbooks', { names: ['race', 'garage'], active: GARAGE });
    await tick();
    expect(lastDock().focusPanel).toHaveBeenCalledWith('cal');
    expect(lastDock().focusPanel).not.toHaveBeenCalledWith('drv');

    // In the garage already: no second switch, the panel is focused at once.
    lastDock().focusPanel.mockClear();
    expect(shellRegistry().run('calibration.pick')).toBe(true);
    await tick();
    expect(t.opened()).toHaveLength(1);
    expect(lastDock().focusPanel).toHaveBeenCalledWith('cal');
  });
});

describe('calibration commands (C72)', () => {
  it('calibration.choose.<setId> sends calibration.choose for the feed', async () => {
    const t = await mount();
    for (const id of TRACK_SET_IDS) expect(shellRegistry().run(`calibration.choose.${id}`)).toBe(true);
    expect(shellRegistry().run('calibration.choose.defaults')).toBe(true);
    expect(t.chosen()).toEqual([
      ...TRACK_SET_IDS.map((setId) => ({ kind: 'calibration.choose', feedId: FEED, setId })),
      { kind: 'calibration.choose', feedId: FEED, setId: null },
    ]);
    expect(screen.queryByTestId('overlay')).toBeNull();
  });

  // Ported from calibration-prompt.test.ts.
  it('calibration.pick, calibration.choose.<setId> per set of the session track and calibration.choose.defaults are in the registry', async () => {
    await mount();
    const ids = shellRegistry()
      .list()
      .map((c) => c.id)
      .filter((id) => id.startsWith('calibration.'));
    expect(ids.sort()).toEqual(['calibration.choose.after-floor-upgrade', 'calibration.choose.defaults', 'calibration.choose.league', 'calibration.choose.pre-season', 'calibration.pick']);
  });

  // Ported from calibration-prompt.test.ts.
  it('the calibration commands are listed in the palette', async () => {
    await mount();
    press('k', { ctrl: true });
    await tick();
    const overlay = screen.getByTestId('overlay');
    for (const command of shellRegistry().list().filter((c) => c.id.startsWith('calibration.'))) {
      expect(within(overlay).getAllByText(command.title).length).toBeGreaterThan(0);
    }
  });

  // Ported from calibration-prompt.test.ts.
  it('the per-set commands follow calibration.active: a session on another track has that track’s sets', async () => {
    const t = await mount();
    await t.push('calibration.active', active({ sessionUid: 's2', trackId: MONZA, setId: 'monza-dry', setName: 'monza-dry' }));
    const ids = shellRegistry()
      .list()
      .map((c) => c.id)
      .filter((id) => id.startsWith('calibration.choose.'));
    expect(ids.sort()).toEqual(['calibration.choose.defaults', 'calibration.choose.monza-dry']);
  });
});

describe('the top-bar unlinked segment (Q6 A)', () => {
  it('unlinked 1 shows with one unlinked seat; a click runs drivers.open', async () => {
    const t = await mount({ links: links([seat(6)]) });
    const segment = screen.getByTestId('segment-unlinked');
    const calibration = screen.getByTestId('segment-calibration');
    expect(segment.parentElement).toBe(calibration.parentElement);
    expect(calibration.nextElementSibling).toBe(segment);
    const button = within(segment).getByTestId('unlinked-count');
    expect(segmentText(button)).toBe('unlinked 1');
    const count = [...button.querySelectorAll<HTMLElement>('*')].find((el) => el.textContent?.trim() === '1');
    expect(count?.getAttribute('style') ?? '').toContain(role('text'));
    expect(button.getAttribute('style') ?? '').not.toContain(role('text'));

    const run = vi.spyOn(CommandRegistry.prototype, 'run');
    await fireEvent.click(button);
    await tick();
    expect(run).toHaveBeenCalledWith('drivers.open');
    expect(t.opened()).toEqual([{ kind: 'workbook.open', name: 'garage' }]);
    await t.push('ui.workbooks', { names: ['race', 'garage'], active: GARAGE });
    await tick();
    expect(lastDock().focusPanel).toHaveBeenCalledWith('drv');
  });

  it('no segment at 0 and without a session', async () => {
    const t = await mount({ active: unknown('notApplicable') });
    expect(screen.queryByTestId('unlinked-count')).toBeNull();
    expect(segmentText(screen.getByTestId('segment-unlinked'))).toBe('');
    await t.push('drivers.links', links([]));
    await tick();
    expect(screen.queryByTestId('unlinked-count')).toBeNull();
    await t.push('drivers.links', links([seat(6), seat(7)]));
    await tick();
    expect(segmentText(screen.getByTestId('unlinked-count'))).toBe('unlinked 2');
  });
});

describe('the top-bar calibration segment (ported)', () => {
  it('sits on the left after the moment segment and reads calibration and the set name (Q5)', async () => {
    await mount();
    const segment = screen.getByTestId('segment-calibration');
    const moment = screen.getByTestId('segment-moment');
    expect(segment.parentElement).toBe(moment.parentElement);
    expect(moment.compareDocumentPosition(segment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(segmentText(within(segment).getByTestId('calibration-name'))).toBe('calibration league');
  });

  it('reads calibration defaults when the run uses no set', async () => {
    await mount({ active: active({ setId: null, setName: '', snapshot: null, picked: true }) });
    expect(segmentText(screen.getByTestId('calibration-name'))).toBe('calibration defaults');
  });

  it('shows nothing while calibration.active is unknown', async () => {
    await mount({ active: unknown('notApplicable') });
    expect(screen.queryByTestId('calibration-name')).toBeNull();
  });

  it('a click invokes calibration.pick by id, which switches to the garage', async () => {
    const t = await mount();
    const run = vi.spyOn(CommandRegistry.prototype, 'run');
    await fireEvent.click(screen.getByTestId('calibration-name'));
    await tick();
    expect(run).toHaveBeenCalledWith('calibration.pick');
    expect(t.opened()).toEqual([{ kind: 'workbook.open', name: 'garage' }]);
  });
});
