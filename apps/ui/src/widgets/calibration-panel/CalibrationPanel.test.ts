// @vitest-environment jsdom
// The calibration panel's controls and what they send (spec 6, plan Task 15; mockup
// docs/design/2026-11-06-sp4.1a/calibration-panel.html; C65, C69, C73, C74). Contract assumed of `CalibrationPanel.svelte`
// (props `WidgetProps<typeof widget>`, data `sets`, `values`, `candidates`, `active`):
//  - the track: the running session's (`active.value.trackId`); without a session (`active` unknown) the newest stored
//    session's (`candidates.newestTrackId`), in the panel's own track picker `track-picker` (a <select>, option values
//    the track ids as strings: every track with a set or with suggestions), a window-local choice that sends nothing (C73);
//  - the set picker `set-picker` (a <select>, option values the set ids) lists the track's sets in the topic's order;
//    it starts on the running session's set, else on the track's first set; a window-local choice; `session-state`
//    reads `text.activeInRace` while the picked set is the running one, `text.noSession` without a session;
//  - full mode: buttons `set-new`, `set-copy`, `set-rename`, `set-delete`; new, copy and rename open a text field
//    `set-name`, whose commit (its `change` event) sends the action with the typed name; delete sends at once;
//  - SOURCES: per fit of the picked set (`values.bySet[setId].fits`, in order, index i) a row `source-<i>` with a remove
//    button `source-remove-<i>`; a fitted source has `source-open-<i>`, which opens its laps: per lap of `lapList` a
//    toggle `lap-<i>-<lapNumber>`, except on laps that are never pace laps (`use` `{ excluded }`); a toggle sends
//    `calibration.lap.exclude` for a lap the user keeps and `calibration.lap.include` for one the user excluded;
//    a skipped source shows `text.missing` or `text.stale` in the warning role with `text.skippedHover[why]` on hover;
//  - SUGGESTIONS: per candidate of the track (index i) a row `candidate-<i>` with `candidate-add-<i>`;
//  - every value of the set is a cell `value-<priors key>`; an entry no source covers shows the kit's unknown mark
//    with `text.noSource` on hover; no `ᶜ` in the panel (README Q3 A);
//  - every value has an override field `override-<priors key>` (full mode), holding the set's override when it has one,
//    in the unit the cell shows (s for deg, sd, offset, pit loss and the age-loss limit; % for wear and the wear
//    limit); a commit (its `change` event) of a number sends `calibration.override.set` with the value in the key's
//    unit (ms, %), of an empty field `calibration.override.clear` (nothing without an override); a text that is no
//    number sends nothing, shows `text.rejected(text.notANumber)` in `rejection` and the field shows the set's override
//    again (C73);
//  - a rejection (the panel's `send` resolves `{ ok: false, message }`) shows `text.rejected(message)` in `rejection`;
//    the field keeps its draft. A `linkLost` outcome (set by the UI connection, no message) shows
//    `text.rejected(text.linkLost)` (C68: the panel words it).
// `send` comes from the panel (kit `getUiActions`); here test/kit/ActionsHarness.svelte stands in for it. Its result is
// the bridge's `actionResult` (requested kit change, Task 15 report: `send` resolves the result).
import type { UiAction } from '@pitwall/contracts';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import { calibration, sourceMark, unknownMark } from '../../kit/text.ts';
import { formatCount, formatDay, formatLapRange, formatSeconds, formatSigma, formatSignedSeconds } from '../../kit/values/format.ts';
import { sourceTitle } from '../../kit/values/source-badge.ts';
import { role } from '../../theme/index.ts';
import CalibrationPanel from './CalibrationPanel.svelte';
import {
  cases, fp1Kuh, fp2LinSoft, key, leagueDefaults, MONZA, raceKuh, raceLin, SILVERSTONE, TRACK_NOTE, type PanelData,
} from './fixtures.ts';
import * as text from './text.ts';
import { widget } from './widget.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** What the bridge answers an action: accepted, or rejected with its reason (`linkLost`: the UI connection's). */
type Outcome = { ok: true } | { ok: false; reason: 'invalid' | 'notSupported' | 'linkLost'; message?: string };
const accepted = (): Promise<Outcome> => Promise.resolve({ ok: true });
const rejectedWith = (message: string) => (): Promise<Outcome> => Promise.resolve({ ok: false, reason: 'invalid', message });

const SIZES = { compact: { cols: 36, rows: 7 }, full: { cols: 76, rows: 37 } } as const;

function mount(data: PanelData, { respond = accepted, mode = 'full' }: { respond?: (a: UiAction) => Promise<Outcome>; mode?: keyof typeof SIZES } = {}) {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const sent: UiAction[] = [];
  const size = SIZES[mode];
  const { container } = render(ActionsHarness, {
    send: (action: UiAction) => {
      sent.push(action);
      return respond(action);
    },
    actions: widget.actions,
    component: CalibrationPanel as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data,
      options: {},
      size: { mode, ...size, px: { width: size.cols * 8, height: size.rows * 16 }, dpr: 1 },
      link: {},
    },
  });
  return { container, sent };
}

const find = (c: HTMLElement, testId: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
function get<T extends HTMLElement = HTMLElement>(c: HTMLElement, testId: string): T {
  const el = find(c, testId);
  if (el === null) throw new Error(`no ${testId}`);
  return el as T;
}
/** Types `value` into a field and commits it (its `change` event, as Enter or leaving the field does). */
async function commit(c: HTMLElement, testId: string, value: string): Promise<void> {
  const field = get<HTMLInputElement>(c, testId);
  await fireEvent.input(field, { target: { value } });
  await fireEvent.change(field, { target: { value } });
}
async function pick(c: HTMLElement, testId: string, value: string): Promise<void> {
  await fireEvent.change(get<HTMLSelectElement>(c, testId), { target: { value } });
}
const options = (c: HTMLElement, testId: string): string[] => [...get<HTMLSelectElement>(c, testId).options].map((o) => o.value);
/** The innermost element of `scope` whose own text, trimmed, is `t`. */
const cellWithText = (scope: HTMLElement, t: string): HTMLElement | undefined =>
  [...scope.querySelectorAll<HTMLElement>('*')].reverse().find((e) => (e.textContent ?? '').trim() === t);
/** The colour an element shows: its own inline colour or the nearest ancestor's, up to the widget. */
function colourOf(el: HTMLElement | undefined, stop: HTMLElement): string {
  for (let e: HTMLElement | null = el ?? null; e !== null && e !== stop.parentElement; e = e.parentElement) {
    if (e.style.color !== '') return e.style.color;
  }
  return '';
}
/** Every hover on or around a cell: its nearest titled ancestor's (or its own) and its descendants'. */
const titlesAround = (cell: HTMLElement): string[] =>
  [cell.closest('[title]'), ...cell.querySelectorAll('[title]')].flatMap((e) => (e === null ? [] : [e.getAttribute('title') ?? '']));
/** Shown dim: the `textDim` role inline, or inside the panel's `dim` class. */
const isDim = (el: HTMLElement | undefined, stop: HTMLElement): boolean =>
  el !== undefined && (colourOf(el, stop) === role('textDim') || el.closest('.dim') !== null);

const league = { trackId: SILVERSTONE, setId: 'league' } as const;

describe('calibration-panel: each control sends its action with the exact payload', () => {
  it('new opens a name field; its commit sends calibration.set.create with the track and the name', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'set-new'));
    await commit(c, 'set-name', 'wet-race');
    expect(sent).toEqual([{ kind: 'calibration.set.create', trackId: SILVERSTONE, name: 'wet-race' }]);
  });

  it('copy sends calibration.set.copy of the picked set with the new name', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'set-copy'));
    await commit(c, 'set-name', 'league-copy');
    expect(sent).toEqual([{ kind: 'calibration.set.copy', ...league, name: 'league-copy' }]);
  });

  it('rename sends calibration.set.rename of the picked set with the new name', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'set-rename'));
    await commit(c, 'set-name', 'league-2026');
    expect(sent).toEqual([{ kind: 'calibration.set.rename', ...league, name: 'league-2026' }]);
  });

  it('delete sends calibration.set.delete of the picked set', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'set-delete'));
    expect(sent).toEqual([{ kind: 'calibration.set.delete', ...league }]);
  });

  it('the set picker is window-local: picking a set sends nothing, and the controls then act on it', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await pick(c, 'set-picker', 'pre-season');
    expect(sent).toEqual([]);
    await fireEvent.click(get(c, 'set-delete'));
    expect(sent).toEqual([{ kind: 'calibration.set.delete', trackId: SILVERSTONE, setId: 'pre-season' }]);
  });

  it('remove sends calibration.source.remove with the source', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'source-remove-1'));
    expect(sent).toEqual([{ kind: 'calibration.source.remove', ...league, source: raceLin }]);
  });

  it('a missing source stays removable', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'source-remove-3'));
    expect(sent).toEqual([{ kind: 'calibration.source.remove', ...league, source: fp2LinSoft }]);
  });

  it('add sends calibration.source.add with the suggestion\'s source', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'candidate-add-0'));
    expect(sent).toEqual([{ kind: 'calibration.source.add', ...league, source: fp1Kuh }]);
  });

  it('a source opens to its laps; a never-pace lap has no toggle', async () => {
    const { container: c } = mount(cases.activeLeague);
    expect(find(c, 'lap-0-2')).toBeNull();
    await fireEvent.click(get(c, 'source-open-0'));
    expect(find(c, 'lap-0-2')).not.toBeNull();
    expect(find(c, 'lap-0-14')).not.toBeNull();
    for (const lap of [1, 9, 10, 22]) expect(find(c, `lap-0-${lap}`), `lap ${lap}`).toBeNull();
  });

  it('the toggle of a kept lap sends calibration.lap.exclude', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'source-open-0'));
    await fireEvent.click(get(c, 'lap-0-2'));
    expect(sent).toEqual([{ kind: 'calibration.lap.exclude', ...league, source: raceKuh, lap: 2 }]);
  });

  it('the toggle of a lap the user excluded sends calibration.lap.include', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await fireEvent.click(get(c, 'source-open-0'));
    await fireEvent.click(get(c, 'lap-0-14'));
    expect(sent).toEqual([{ kind: 'calibration.lap.include', ...league, source: raceKuh, lap: 14 }]);
  });

  it('an override commit sends calibration.override.set with the typed number in the key\'s unit (deg: s to ms)', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await commit(c, `override-${key.deg('medium')}`, '0.050');
    expect(sent).toEqual([{ kind: 'calibration.override.set', ...league, key: key.deg('medium'), value: 50 }]);
  });

  it('a pit-loss override is typed in s and sent in ms', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await commit(c, `override-${key.pit('green')}`, '21.5');
    expect(sent).toEqual([{ kind: 'calibration.override.set', ...league, key: key.pit('green'), value: 21_500 }]);
  });

  it('a wear override is typed and sent in % per lap', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await commit(c, `override-${key.wear('medium', 'fl')}`, '2.1');
    expect(sent).toEqual([{ kind: 'calibration.override.set', ...league, key: key.wear('medium', 'fl'), value: 2.1 }]);
  });

  it('a field holds the set\'s override; emptying it sends calibration.override.clear', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    expect(get<HTMLInputElement>(c, `override-${key.deg('hard')}`).value).toBe('0.045');
    await commit(c, `override-${key.deg('hard')}`, '');
    expect(sent).toEqual([{ kind: 'calibration.override.clear', ...league, key: key.deg('hard') }]);
  });

  it('a field that holds no number sends nothing', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await commit(c, `override-${key.deg('medium')}`, 'fast');
    expect(sent).toEqual([]);
  });
});

describe('calibration-panel: a rejection reason is shown', () => {
  it('shows the bridge\'s reason for a rejected override, and the field keeps the draft', async () => {
    const message = 'deg/lap must be 0.000 to 1.000 s';
    const { container: c, sent } = mount(cases.activeLeague, { respond: rejectedWith(message) });
    await commit(c, `override-${key.deg('hard')}`, '3.5');
    expect(sent).toHaveLength(1);
    await vi.waitFor(() => expect(find(c, 'rejection')?.textContent?.trim()).toBe(text.rejected(message)));
    expect(get<HTMLInputElement>(c, `override-${key.deg('hard')}`).value).toBe('3.5');
  });

  it('shows the bridge\'s reason for a rejected set name', async () => {
    const message = 'Silverstone already has a set named league';
    const { container: c } = mount(cases.activeLeague, { respond: rejectedWith(message) });
    await fireEvent.click(get(c, 'set-new'));
    await commit(c, 'set-name', 'league');
    await vi.waitFor(() => expect(find(c, 'rejection')?.textContent?.trim()).toBe(text.rejected(message)));
  });

  it('an override that is not a number sends nothing, shows a rejection and restores the field', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    // hard's DEG/LAP holds the set's override 0.045 s
    const field = `override-${key.deg('hard')}`;
    expect(get<HTMLInputElement>(c, field).value).toBe('0.045');
    await commit(c, field, 'fast');
    expect(sent).toEqual([]);
    await vi.waitFor(() => expect(find(c, 'rejection')?.textContent?.trim()).toBe(text.rejected(text.notANumber)));
    expect(get<HTMLInputElement>(c, field).value).toBe('0.045');
    // a field without an override shows empty again
    await commit(c, `override-${key.deg('medium')}`, 'slow');
    expect(sent).toEqual([]);
    expect(get<HTMLInputElement>(c, `override-${key.deg('medium')}`).value).toBe('');
    expect(find(c, 'rejection')?.textContent?.trim()).toBe(text.rejected(text.notANumber));
  });

  it('an empty field without an override sends nothing and shows no rejection', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await commit(c, `override-${key.deg('medium')}`, '');
    expect(sent).toEqual([]);
    await Promise.resolve();
    expect(find(c, 'rejection')?.textContent?.trim() ?? '').toBe('');
  });

  it('a linkLost outcome is worded by the panel', async () => {
    const { container: c, sent } = mount(cases.activeLeague, { respond: () => Promise.resolve({ ok: false, reason: 'linkLost' }) });
    await commit(c, `override-${key.deg('hard')}`, '0.050');
    expect(sent).toHaveLength(1);
    await vi.waitFor(() => expect(find(c, 'rejection')?.textContent?.trim()).toBe(text.rejected(text.linkLost)));
    expect(text.linkLost).not.toBe(text.rejectedNoReason);
  });

  it('shows no rejection for an accepted action', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    await commit(c, `override-${key.deg('medium')}`, '0.050');
    expect(sent).toHaveLength(1);
    await Promise.resolve();
    expect(find(c, 'rejection')?.textContent?.trim() ?? '').toBe('');
  });
});

describe('calibration-panel: a skipped source shows why it is left out', () => {
  it('a missing source shows "missing" in the warning role with why on hover', () => {
    const { container: c } = mount(cases.activeLeague);
    const word = cellWithText(get(c, 'source-3'), text.missing);
    expect(word).toBeDefined();
    expect(word?.closest('[title]')?.getAttribute('title')).toBe(text.skippedHover.missing);
    expect(colourOf(word, c)).toBe(role('warning'));
  });

  it('a stale source shows "stale" in the warning role with why on hover', () => {
    const { container: c } = mount(cases.staleSource);
    const word = cellWithText(get(c, 'source-3'), text.stale);
    expect(word).toBeDefined();
    expect(word?.closest('[title]')?.getAttribute('title')).toBe(text.skippedHover.stale);
    expect(colourOf(word, c)).toBe(role('warning'));
  });

  it('a missing source shows the word in compact mode too', () => {
    const { container: c } = mount(cases.activeLeague, { mode: 'compact' });
    expect(cellWithText(get(c, 'source-3'), text.missing)).toBeDefined();
  });
});

describe('calibration-panel: what a source and a value show', () => {
  it('a source row shows its date, stint, used of its laps, its DEG/LAP and its DRIFT (README Q1 A)', () => {
    const row = get(mount(cases.activeLeague).container, 'source-0').textContent ?? '';
    for (const part of [formatDay('2026-10-15'), formatLapRange(1, 22), '17/22', formatSignedSeconds(54, 3), formatSigma(0.4)]) {
      expect(row, part).toContain(part);
    }
  });

  // Ported (SP4.1a fx3b, C82): soft's DEG/LAP now has a default (R35); a value without a source and without a default
  // (tyre-life's wear rates declare no fallback) keeps the unknown mark.
  it('a value no source covers and no default fills shows the unknown mark with why on hover; the panel carries no ᶜ (README Q3 A)', () => {
    const { container: c } = mount(cases.activeLeague);
    const cell = get(c, `value-${key.wear('soft', 'fl')}`);
    expect(cell.textContent?.trim()).toBe(unknownMark.insufficientData);
    expect(cell.closest('[title]')?.getAttribute('title')).toBe(text.noSource);
    expect(c.textContent).not.toContain('ᶜ');
  });

  // SP4.1a fx3b (R35, R37; README Q3 A; C65, C68): a value no source covers shows the run's default from the topic's
  // `defaults`, followed by the kit's `SourceBadge` (`ᵈ`) whose hover is the kit's `sourceTitle` (the default's note),
  // the value dim (`textDim`) as the mockup draws it. A covered value carries no mark.
  it('an uncovered value shows its default with ᵈ and the default\'s note', () => {
    const { container: c } = mount(cases.activeLeague);
    const shown: [string, string][] = [
      [key.offset('soft'), formatSignedSeconds(-405, 3)],
      [key.deg('soft'), formatSignedSeconds(60, 3)],
      [key.sd('soft'), formatSeconds(60, 3)],
      [key.offset('hard'), formatSignedSeconds(367, 3)],
      [key.sd('hard'), formatSeconds(60, 3)],
      [key.pit('sc'), formatSeconds(9_800, 1)],
    ];
    for (const [k, value] of shown) {
      const cell = get(c, `value-${k}`);
      const def = leagueDefaults[k];
      if (def === undefined) throw new Error(`the fixture lists no default for ${k}`);
      expect(cell.textContent, k).toContain(value);
      expect(cell.textContent, k).toContain(sourceMark.default);
      expect(cell.textContent, k).not.toContain(unknownMark.insufficientData);
      expect(titlesAround(cell), k).toContain(sourceTitle(def.source));
      expect(sourceTitle(def.source), k).toContain(TRACK_NOTE);
      expect(isDim(cellWithText(cell, value), c), k).toBe(true);
    }
    // covered values carry no mark: medium's from its sources, hard's DEG/LAP from the override, green from its stops
    for (const k of [key.deg('medium'), key.deg('hard'), key.pit('green')]) expect(get(c, `value-${k}`).textContent, k).not.toContain(sourceMark.default);
    // compact mode's deg and pit lines show the defaults with their mark too
    cleanup();
    const compact = mount(cases.activeLeague, { mode: 'compact' }).container;
    for (const k of [key.deg('soft'), key.pit('sc')]) expect(get(compact, `value-${k}`).textContent, k).toContain(sourceMark.default);
  });

  // SP4.1a fx3b (R37, C65): N per compound and STOPS per condition are the topic's `samples` (the units' counts), in
  // cells `samples-degradation.nuMsPerLap.<compound>` and `samples-pitLoss.ms.<condition>`; the panel counts nothing.
  it('N and STOPS show the topic\'s samples', () => {
    const { container: c } = mount(cases.activeLeague);
    // the headers, wording of the widget's text.ts (C68): `valueHeaders.n` and `pitHeaders.stops`, as the mockup's
    const headers = { n: (text.valueHeaders as Record<string, string>)['n'], stops: (text.pitHeaders as Record<string, string>)['stops'] };
    expect(headers).toEqual({ n: 'N', stops: 'STOPS' });
    // N after RR, STOPS after SET (the mockup's columns)
    expect(c.textContent).toMatch(new RegExp(`${text.valueHeaders.rr}\\s+${headers.n}\\b`));
    expect(c.textContent).toMatch(new RegExp(`${text.pitHeaders.set}\\s+${headers.stops}\\b`));
    const expected: [string, number][] = [
      [key.deg('soft'), 0], [key.deg('medium'), 3], [key.deg('hard'), 0], [key.pit('green'), 6], [key.pit('vsc'), 1], [key.pit('sc'), 0],
    ];
    for (const [k, n] of expected) expect(get(c, `samples-${k}`).textContent?.trim(), k).toBe(formatCount(n));

    // other samples in the topic, other numbers: nothing is counted from the fits (three medium sources) or the stops
    cleanup();
    const league = cases.activeLeague.values.bySet['league']!;
    const samples = { ...league.samples, [key.deg('medium')]: 7, [key.pit('green')]: 11 };
    const other = mount({ ...cases.activeLeague, values: { bySet: { ...cases.activeLeague.values.bySet, league: { ...league, samples } } } }).container;
    expect(get(other, `samples-${key.deg('medium')}`).textContent?.trim()).toBe(formatCount(7));
    expect(get(other, `samples-${key.pit('green')}`).textContent?.trim()).toBe(formatCount(11));
  });

  // SP4.1a fx3b (R37, C65; mockup `created 28 Sep · last used 15 Oct · 4 sources, 1 missing`): the sources are the set's,
  // the missing count is the topic's `missing`.
  it('the set line shows the sources and the missing count', () => {
    const { container: c } = mount(cases.activeLeague);
    expect(c.textContent).toContain(`${calibration.sources(4)}, ${calibration.missing(1)}`);

    // the topic's count, not a count of the skipped fits (one)
    cleanup();
    const league = cases.activeLeague.values.bySet['league']!;
    const two = mount({ ...cases.activeLeague, values: { bySet: { ...cases.activeLeague.values.bySet, league: { ...league, missing: 2 } } } }).container;
    expect(two.textContent).toContain(`${calibration.sources(4)}, ${calibration.missing(2)}`);
    expect(two.textContent).not.toContain(calibration.missing(1));

    // the soft source stale instead: nothing is missing, and the line says no missing count
    cleanup();
    const stale = mount(cases.staleSource).container;
    expect(stale.textContent).toContain(calibration.sources(4));
    expect(stale.textContent).not.toContain(calibration.missing(0));
  });

  it('compact mode drops the controls: no set actions, override fields or suggestions', () => {
    const { container: c } = mount(cases.activeLeague, { mode: 'compact' });
    for (const id of ['set-new', 'set-copy', 'set-rename', 'set-delete', `override-${key.deg('medium')}`, 'candidate-0', 'source-open-0']) {
      expect(find(c, id), id).toBeNull();
    }
    expect(find(c, 'source-0')).not.toBeNull();
  });
});

// SP4.3b2 Task 17 (mockup docs/design/2026-11-12-sp4.3b/calibration-panel.html, README Q8 A; C68, C73, C74). Contract
// assumed: right after the set picker (before `session-state`), a button `set-prefer`. On the shown set when it is the
// track's preferred one (`CalibrationSet.preferred`), it holds the kit's `Star` (`svg.star`), in the text role (not dim),
// with `text.preferredHover` on hover, and a click sends `calibration.prefer` with `setId: null`; on any other set it
// holds the kit's `StarOutline` (`svg.star-outline`), a quiet button (dim), with `text.preferHover` on hover, and a click
// sends `calibration.prefer` with its `setId`. The set picker's option of the preferred set holds `svg.star`; no other
// option holds a star. JetBrains Mono has no ★ or ☆ (README): the panel shows no ★ or ☆ character.
describe('calibration-panel: the preferred set', () => {
  const after = (a: HTMLElement, b: HTMLElement): boolean => (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const hovers = text as unknown as Record<string, unknown>;

  it('the preferred set shows ★ after the picker; a click sends calibration.prefer with setId null', async () => {
    const { container: c, sent } = mount(cases.activeLeague);
    const star = get(c, 'set-prefer');
    expect(after(star, get(c, 'set-picker'))).toBe(true);
    expect(after(get(c, 'session-state'), star)).toBe(true);
    expect(star.querySelector('svg.star')).not.toBeNull();
    expect(star.querySelector('svg.star-outline')).toBeNull();
    expect(isDim(star, c)).toBe(false);
    expect(typeof hovers['preferredHover']).toBe('string');
    expect(star.closest('[title]')?.getAttribute('title')).toBe(hovers['preferredHover']);
    expect(c.textContent).not.toMatch(/[★☆]/);
    await fireEvent.click(star);
    expect(sent).toEqual([{ kind: 'calibration.prefer', trackId: SILVERSTONE, setId: null }]);
  });

  it('any other set shows ☆ as a quiet button that sends calibration.prefer with its setId', async () => {
    const { container: c, sent } = mount(cases.notPreferred);
    const outline = get(c, 'set-prefer');
    expect(outline.tagName).toBe('BUTTON');
    expect(after(outline, get(c, 'set-picker'))).toBe(true);
    expect(outline.querySelector('svg.star-outline')).not.toBeNull();
    expect(outline.querySelector('svg.star')).toBeNull();
    expect(isDim(outline, c)).toBe(true);
    expect(typeof hovers['preferHover']).toBe('string');
    expect(outline.closest('[title]')?.getAttribute('title')).toBe(hovers['preferHover']);
    await fireEvent.click(outline);
    expect(sent).toEqual([{ kind: 'calibration.prefer', trackId: SILVERSTONE, setId: 'after-floor-upgrade' }]);
    // a picked set (window-local) shows ☆ too, and the click names it
    cleanup();
    const picked = mount(cases.activeLeague);
    await pick(picked.container, 'set-picker', 'pre-season');
    expect(get(picked.container, 'set-prefer').querySelector('svg.star-outline')).not.toBeNull();
    await fireEvent.click(get(picked.container, 'set-prefer'));
    expect(picked.sent).toEqual([{ kind: 'calibration.prefer', trackId: SILVERSTONE, setId: 'pre-season' }]);
  });

  it('the open picker marks the preferred set with ★', () => {
    const { container: c } = mount(cases.notPreferred);
    const byValue = Object.fromEntries([...get<HTMLSelectElement>(c, 'set-picker').options].map((o) => [o.value, o]));
    expect(byValue['league']?.querySelector('svg.star')).not.toBeNull();
    for (const id of ['pre-season', 'after-floor-upgrade']) {
      expect(byValue[id]?.querySelector('svg.star, svg.star-outline'), id).toBeNull();
    }
  });

  it('compact: ★ or ☆ after the picker', async () => {
    const preferred = mount(cases.activeLeague, { mode: 'compact' });
    const star = get(preferred.container, 'set-prefer');
    expect(after(star, get(preferred.container, 'set-picker'))).toBe(true);
    expect(star.querySelector('svg.star')).not.toBeNull();
    await fireEvent.click(star);
    expect(preferred.sent).toEqual([{ kind: 'calibration.prefer', trackId: SILVERSTONE, setId: null }]);
    cleanup();
    const other = mount(cases.notPreferred, { mode: 'compact' });
    const outline = get(other.container, 'set-prefer');
    expect(after(outline, get(other.container, 'set-picker'))).toBe(true);
    expect(outline.querySelector('svg.star-outline')).not.toBeNull();
    await fireEvent.click(outline);
    expect(other.sent).toEqual([{ kind: 'calibration.prefer', trackId: SILVERSTONE, setId: 'after-floor-upgrade' }]);
  });
});

describe('calibration-panel: the track', () => {
  it('with a session: the running session\'s track and set, no track picker, "active in this race"', () => {
    const { container: c } = mount(cases.activeLeague);
    expect(find(c, 'track-picker')).toBeNull();
    expect(get<HTMLSelectElement>(c, 'set-picker').value).toBe('league');
    expect(options(c, 'set-picker')).toEqual(['pre-season', 'league', 'after-floor-upgrade']);
    expect(get(c, 'session-state').textContent?.trim()).toBe(text.activeInRace);
  });

  it('on defaults: the track\'s sets, none active', () => {
    const { container: c } = mount(cases.defaultsChosen);
    expect(options(c, 'set-picker')).toEqual(['pre-season', 'league', 'after-floor-upgrade']);
    expect(find(c, 'session-state')?.textContent?.trim() ?? '').not.toBe(text.activeInRace);
  });

  it('without a session: the newest stored session\'s track, in the panel\'s own track picker; "no session"', () => {
    const { container: c } = mount(cases.noSession);
    expect(get<HTMLSelectElement>(c, 'track-picker').value).toBe(String(SILVERSTONE));
    expect(options(c, 'track-picker')).toEqual(expect.arrayContaining([String(SILVERSTONE), String(MONZA)]));
    expect(options(c, 'set-picker')).toEqual(['pre-season', 'league', 'after-floor-upgrade']);
    expect(get(c, 'session-state').textContent?.trim()).toBe(text.noSession);
  });

  it('without a session the controls act on the track\'s first set until another is picked', async () => {
    const { container: c, sent } = mount(cases.noSession);
    await fireEvent.click(get(c, 'set-delete'));
    expect(sent).toEqual([{ kind: 'calibration.set.delete', trackId: SILVERSTONE, setId: 'pre-season' }]);
  });

  it('picking another track is window-local: it sends nothing, shows that track\'s sets, and new creates on it', async () => {
    const { container: c, sent } = mount(cases.noSession);
    await pick(c, 'track-picker', String(MONZA));
    expect(sent).toEqual([]);
    expect(options(c, 'set-picker')).toEqual(['monza-test']);
    await fireEvent.click(get(c, 'set-new'));
    await commit(c, 'set-name', 'monza-2');
    expect(sent).toEqual([{ kind: 'calibration.set.create', trackId: MONZA, name: 'monza-2' }]);
  });
});

// SP4.3b2 Task 18v: the display against its approved mockup (calibration-panel.html; memory "no explaining text in
// displays"). The fit of full/defaultsChosen, compact/notPreferred and compact 75×28 is covered by fit.spec (Playwright).
describe('calibration-panel against the mockup (Task 18v)', () => {
  /** The section notes the panel showed as sentences: never visible text (a hover may carry them). */
  const NOTES = ['one stint each', 'opens its laps', 'our stints on this track not in the set', 'this weekend first', 'ovr = your override'];
  /** Every visible text node of the widget, trimmed, without empty ones (option text is the picker's list). */
  function visibleTexts(c: HTMLElement): string[] {
    const walker = c.ownerDocument.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const out: string[] = [];
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (t !== '' && n.parentElement?.closest('title, option, script, style') === null) out.push(t);
    }
    return out;
  }

  it('no section note in the visible text: SOURCES, SUGGESTIONS and VALUES PER COMPOUND stand alone', () => {
    for (const [name, data] of Object.entries(cases)) {
      for (const mode of ['full', 'compact'] as const) {
        const { container: c } = mount(data, { mode });
        const shown = visibleTexts(c).join(' ');
        for (const note of NOTES) expect(shown, `${name} ${mode}`).not.toContain(note);
        cleanup();
      }
    }
    // the titles stay
    const { container: c } = mount(cases.activeLeague);
    const shown = visibleTexts(c);
    for (const title of [text.sourcesTitle, text.suggestionsTitle, text.valuesTitle]) expect(shown, title).toContain(title);
  });
});
