// @vitest-environment jsdom
// SP4.1a Task 16 (spec 3.3; mockup docs/design/2026-11-06-sp4.1a/start-prompt.html, README Q5, Q6, Q8 answered A):
// the session-start calibration prompt, its commands and the top-bar segment (C67, C70, C72, C73).
// Contract assumed of the shell (WindowShell.svelte with its dock mocked, as in topbar-commands.test.ts):
//  - the shell holds `calibration.sets` and `calibration.values` (global) and `calibration.active` of `defaultFeed`;
//  - commands (C72), built like `panel.add.<name>`: `calibration.pick` (opens the prompt at any time), one
//    `calibration.choose.<setId>` per set of the active session's track (`calibration.active.trackId`), and
//    `calibration.choose.defaults`; each `calibration.choose.*` sends
//    `uiAction { kind: 'calibration.choose', feedId: defaultFeed, setId }` (`null` for defaults) and closes the prompt;
//  - the prompt opens by itself once per new `calibration.active.sessionUid` when the track has at least one set (Q6);
//    its list is the test id `calibration-prompt`; one row per set of the track, in the order of `calibration.sets`, test
//    id `calibration-choice-<setId>`, then `calibration-choice-defaults` last; the preselection (the active set while
//    `picked` is false) carries the word `preselected`; a set with a source skipped as `missing` in `calibration.values`
//    shows `<n> missing`; a click on a row invokes its command by id (`registry.run`); the cursor starts on the
//    preselection, ArrowUp/ArrowDown move it, Enter chooses; Escape or a click outside closes it and sends nothing;
//    it is `OVERLAY_COLS.calibration` (70) cells wide;
//  - the top-bar segment `calibration` (TOP_BAR.left, after `moment`): a button `calibration-name` reading
//    `calibration <set name>` or `calibration defaults` (setId null); nothing while `calibration.active` is unknown;
//    a click invokes `calibration.pick` by id.
import type { MachineSpans } from '@pitwall/contracts';
import type { CalibrationActiveValue, CalibrationSet, CalibrationSetsValue, CalibrationValuesValue, OpenSpan } from '@pitwall/domain';
import { carId, unknown } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, press, stubBrowser, workbook } from './shell-harness.ts';

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
  ...over,
});
// The mockup's sample: three sets on the track (league the preselection), one on another track.
const SETS: CalibrationSetsValue = {
  sets: [
    set('league', { lastUsedAt: '2026-10-15' }),
    set('after-floor-upgrade', { createdAt: '2026-11-06' }),
    set('monza-dry', { trackId: MONZA }),
    set('pre-season', { createdAt: '2026-09-02', lastUsedAt: '2026-09-02' }),
  ],
};
const TRACK_SET_IDS = ['league', 'after-floor-upgrade', 'pre-season'];

const source = (firstLap: number) => ({ sessionUid: 'old', weekendId: 'w0', feedCar: carId(5), car: carId(5), firstLap, excludedLaps: [] });
// league: one of its sources is missing (README "1 missing").
const VALUES: CalibrationValuesValue = {
  bySet: {
    league: {
      entries: {},
      defaults: {},
      fits: [
        { source: source(3), skipped: 'missing', sessionDate: unknown('notApplicable'), phase: unknown('notApplicable'), driver: unknown('notApplicable'), compound: unknown('notApplicable') },
        { source: source(12), skipped: 'stale', sessionDate: unknown('notApplicable'), phase: unknown('notApplicable'), driver: unknown('notApplicable'), compound: unknown('notApplicable') },
      ],
    },
  },
};

type Active = Extract<CalibrationActiveValue, { known: true }>['value'];
const active = (over: Partial<Active> = {}): CalibrationActiveValue => ({
  known: true,
  at: 0,
  value: { sessionUid: 's1', trackId: SILVERSTONE, setId: 'league', setName: 'league', snapshot: 'fp-league', picked: false, ...over },
});

/** Watches `register` (it still registers); the shell's registry is the `this` of its first call. */
let registering: { mock: { contexts: unknown[] } } | undefined;
const shellRegistry = (): CommandRegistry => {
  const registry = registering?.mock.contexts[0] as CommandRegistry | undefined;
  if (registry === undefined) throw new Error('the shell registered no command');
  return registry;
};

beforeEach(() => {
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn(), setEditing: vi.fn() }));
  stubBrowser();
  registering = vi.spyOn(CommandRegistry.prototype, 'register');
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Setup = { sets?: CalibrationSetsValue; values?: CalibrationValuesValue; active?: CalibrationActiveValue };
const mount = async (setup: Setup = {}) => {
  const ctx = makeStore();
  render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
  await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
  await ctx.push('ui.linkGroups', [group1()]);
  await ctx.push('calibration.sets', setup.sets ?? SETS);
  await ctx.push('calibration.values', setup.values ?? VALUES);
  await ctx.push('calibration.active', setup.active ?? active());
  await tick();
  const chosen = () => ctx.connection.sent.flatMap((m) => (m.type === 'uiAction' && m.action.kind === 'calibration.choose' ? [m.action] : []));
  return { ...ctx, chosen };
};

const prompt = (): HTMLElement | null => screen.queryByTestId('calibration-prompt');
const rowIds = (): string[] =>
  [...(prompt()?.querySelectorAll<HTMLElement>('[data-testid^="calibration-choice-"]') ?? [])].map((el) => el.dataset['testid'] ?? '');
const row = (id: string): HTMLElement => within(prompt()!).getByTestId(`calibration-choice-${id}`);
/** Keys go where the focus is (the prompt may focus its list); from there they bubble to the window. */
const key = (k: string): void => press(k, {}, document.activeElement ?? window);
const closePrompt = async (): Promise<void> => {
  press('Escape');
  await tick();
};

describe('calibration commands (C72)', () => {
  it('calibration.pick, calibration.choose.<setId> per set of the session track and calibration.choose.defaults are in the registry', async () => {
    await mount();
    const ids = shellRegistry()
      .list()
      .map((c) => c.id)
      .filter((id) => id.startsWith('calibration.'));
    expect(ids.sort()).toEqual(['calibration.choose.after-floor-upgrade', 'calibration.choose.defaults', 'calibration.choose.league', 'calibration.choose.pre-season', 'calibration.pick']);
  });

  it('the calibration commands are listed in the palette', async () => {
    await mount();
    await closePrompt();
    press('k', { ctrl: true });
    await tick();
    const overlay = screen.getByTestId('overlay');
    for (const command of shellRegistry().list().filter((c) => c.id.startsWith('calibration.'))) {
      expect(within(overlay).getAllByText(command.title).length).toBeGreaterThan(0);
    }
  });

  it('each calibration.choose.* sends calibration.choose with the feed and the set id, defaults with null', async () => {
    const t = await mount();
    for (const id of TRACK_SET_IDS) expect(shellRegistry().run(`calibration.choose.${id}`)).toBe(true);
    expect(shellRegistry().run('calibration.choose.defaults')).toBe(true);
    expect(t.chosen()).toEqual([
      ...TRACK_SET_IDS.map((setId) => ({ kind: 'calibration.choose', feedId: FEED, setId })),
      { kind: 'calibration.choose', feedId: FEED, setId: null },
    ]);
  });

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

describe('the start prompt', () => {
  it('opens when calibration.active names a new session: the track’s sets in order, defaults last, the preselection marked', async () => {
    await mount();
    expect(prompt()).not.toBeNull();
    expect(rowIds()).toEqual([...TRACK_SET_IDS, 'defaults'].map((id) => `calibration-choice-${id}`));
    expect(row('league').textContent).toContain('league');
    expect(row('league').textContent).toContain('preselected');
    for (const id of ['after-floor-upgrade', 'pre-season', 'defaults']) expect(row(id).textContent).not.toContain('preselected');
    expect(row('defaults').textContent).toContain('defaults');
  });

  it('a set with a missing source shows how many are missing; a stale one is not counted', async () => {
    await mount();
    expect(row('league').textContent).toContain('1 missing');
    expect(row('after-floor-upgrade').textContent).not.toContain('missing');
  });

  it('is 70 cells wide (OVERLAY_COLS.calibration)', async () => {
    await mount();
    expect(prompt()!.closest<HTMLElement>('[data-testid="overlay"]')!.style.width).toBe('70ch');
  });

  it('opens once per session: not again for the same session uid, again for a new one', async () => {
    const t = await mount();
    await closePrompt();
    expect(prompt()).toBeNull();
    await t.push('calibration.active', active({ picked: false, snapshot: 'fp-league-2' }));
    expect(prompt()).toBeNull();
    await t.push('calibration.sets', { sets: [...SETS.sets] });
    expect(prompt()).toBeNull();
    await t.push('calibration.active', active({ sessionUid: 's2' }));
    expect(prompt()).not.toBeNull();
  });

  it('does not open when the session’s track has no set (Q6)', async () => {
    await mount({ active: active({ trackId: 99, setId: null, setName: '', snapshot: null }) });
    expect(prompt()).toBeNull();
  });

  it('does not open while calibration.active is unknown', async () => {
    await mount({ active: unknown('notApplicable') });
    expect(prompt()).toBeNull();
  });

  it('each entry invokes its command by id, which sends calibration.choose and closes the prompt', async () => {
    const t = await mount();
    const run = vi.spyOn(CommandRegistry.prototype, 'run');
    await fireEvent.click(row('after-floor-upgrade'));
    await tick();
    expect(run).toHaveBeenCalledWith('calibration.choose.after-floor-upgrade');
    expect(t.chosen()).toEqual([{ kind: 'calibration.choose', feedId: FEED, setId: 'after-floor-upgrade' }]);
    expect(prompt()).toBeNull();
  });

  it('the defaults entry invokes calibration.choose.defaults, which sends setId null', async () => {
    const t = await mount();
    const run = vi.spyOn(CommandRegistry.prototype, 'run');
    await fireEvent.click(row('defaults'));
    await tick();
    expect(run).toHaveBeenCalledWith('calibration.choose.defaults');
    expect(t.chosen()).toEqual([{ kind: 'calibration.choose', feedId: FEED, setId: null }]);
    expect(prompt()).toBeNull();
  });

  it('Escape keeps the preselection and sends nothing', async () => {
    const t = await mount();
    await closePrompt();
    expect(prompt()).toBeNull();
    expect(t.chosen()).toEqual([]);
  });

  it('a click outside keeps the preselection and sends nothing', async () => {
    const t = await mount();
    await fireEvent.click(document.querySelector('.backdrop')!);
    await tick();
    expect(prompt()).toBeNull();
    expect(t.chosen()).toEqual([]);
  });

  it('the cursor starts on the preselection; ArrowDown moves it and Enter chooses the set under it', async () => {
    const t = await mount({ active: active({ setId: 'after-floor-upgrade', setName: 'after-floor-upgrade' }) });
    key('ArrowDown');
    await tick();
    key('Enter');
    await tick();
    expect(t.chosen()).toEqual([{ kind: 'calibration.choose', feedId: FEED, setId: 'pre-season' }]);
    expect(prompt()).toBeNull();
  });

  it('Enter at once chooses the preselection; ArrowUp moves the cursor back', async () => {
    const t = await mount();
    key('ArrowDown');
    await tick();
    key('ArrowUp');
    await tick();
    key('Enter');
    await tick();
    expect(t.chosen()).toEqual([{ kind: 'calibration.choose', feedId: FEED, setId: 'league' }]);
  });

  // Fix round 1 (mockup start-prompt.html: `Calibration for this session · Silverstone race`): the title names the track
  // and the session as the top bar's session segment does (`sessionOf` over `situation.weekendPhase`, then
  // `formatSessionKind`, C68); while the weekend phase is pending (no open span) or `none` (no name), the track alone.
  it('the prompt’s title names the track and the session as the top bar does', async () => {
    const t = await mount();
    const title = (): string | undefined =>
      prompt()?.closest<HTMLElement>('[data-testid="overlay"]')?.querySelector<HTMLElement>('.band')?.textContent?.replace(/\s+/g, ' ').trim();
    const weekendPhase = (kind: string, detail: unknown = {}): MachineSpans => ({
      open: [{ machine: 'weekend-phase', id: 0, kind, start: 1000, confirmed: true, detail, startFrame: 1 } as OpenSpan],
    });
    expect(title()).toBe('Calibration for this session · Silverstone');
    const cases: [MachineSpans, string][] = [
      [weekendPhase('race', { format: 'grandPrix' }), 'Calibration for this session · Silverstone race'],
      [weekendPhase('race', { format: 'sprint' }), 'Calibration for this session · Silverstone race'],
      [weekendPhase('practice'), 'Calibration for this session · Silverstone practice'],
      [weekendPhase('qualifying', { format: 'sprintShootout' }), 'Calibration for this session · Silverstone sprint shootout'],
      [weekendPhase('qualifying', { format: 'grandPrix' }), 'Calibration for this session · Silverstone qualifying'],
      [weekendPhase('none'), 'Calibration for this session · Silverstone'],
      [{ open: [] }, 'Calibration for this session · Silverstone'],
    ];
    for (const [spans, expected] of cases) {
      await t.push('situation.weekendPhase', spans);
      expect(title()).toBe(expected);
    }
  });

  it('calibration.pick opens it at any time', async () => {
    await mount();
    await closePrompt();
    expect(shellRegistry().run('calibration.pick')).toBe(true);
    await tick();
    expect(prompt()).not.toBeNull();
    expect(rowIds()).toEqual([...TRACK_SET_IDS, 'defaults'].map((id) => `calibration-choice-${id}`));
  });

  it('calibration.pick opens it on a track without a set, with defaults alone', async () => {
    await mount({ active: active({ trackId: 99, setId: null, setName: '', snapshot: null }) });
    shellRegistry().run('calibration.pick');
    await tick();
    expect(rowIds()).toEqual(['calibration-choice-defaults']);
  });
});

describe('the top-bar calibration segment', () => {
  it('sits on the left after the moment segment and reads calibration and the set name (Q5)', async () => {
    await mount();
    const segment = screen.getByTestId('segment-calibration');
    const moment = screen.getByTestId('segment-moment');
    expect(segment.parentElement).toBe(moment.parentElement);
    expect(moment.compareDocumentPosition(segment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const name = within(segment).getByTestId('calibration-name');
    expect(name.textContent?.replace(/\s+/g, ' ').trim()).toBe('calibration league');
  });

  it('reads calibration defaults when the run uses no set', async () => {
    await mount({ active: active({ setId: null, setName: '', snapshot: null, picked: true }) });
    expect(screen.getByTestId('calibration-name').textContent?.replace(/\s+/g, ' ').trim()).toBe('calibration defaults');
  });

  it('follows calibration.active: a pick shows the picked set', async () => {
    const t = await mount();
    await t.push('calibration.active', active({ setId: 'pre-season', setName: 'pre-season', snapshot: 'fp-pre', picked: true }));
    expect(screen.getByTestId('calibration-name').textContent).toContain('pre-season');
  });

  it('shows nothing while calibration.active is unknown', async () => {
    await mount({ active: unknown('notApplicable') });
    expect(screen.queryByTestId('calibration-name')).toBeNull();
  });

  it('a click invokes calibration.pick by id, which opens the prompt', async () => {
    await mount();
    await closePrompt();
    const run = vi.spyOn(CommandRegistry.prototype, 'run');
    await fireEvent.click(screen.getByTestId('calibration-name'));
    await tick();
    expect(run).toHaveBeenCalledWith('calibration.pick');
    expect(prompt()).not.toBeNull();
  });
});
