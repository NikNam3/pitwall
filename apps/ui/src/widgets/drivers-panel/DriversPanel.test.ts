// @vitest-environment jsdom
// The drivers panel as it renders and what its controls send (SP4.3b spec §10, plan SP4.3b2 Task 16 rows 1–8; mockup
// docs/design/2026-11-12-sp4.3b/drivers-panel.html; C1, C62c, C65, C68, C73, C74). Contract assumed of
// `DriversPanel.svelte` (props `WidgetProps<typeof widget>`, data `profiles`, `links`, `session`, `config`):
//  - SEATS: one seat per distinct (team, race number) of `links.links`, `links.unlinkedSeats` and `links.unlinked`, by race
//    number, an element `seat-<team>-<raceNumber>` showing `#<n>`, the team's name and `→`, then the person picker
//    `link-<team>-<raceNumber>`: a <select> whose options are the persons (value the person id, text the display name, in
//    the topic's order), then `new` (value `:new`) and `none` (value `:none`); it shows the seat's linked person, `:none`
//    for an unlinked seat. Picking a person sends `drivers.link` with the seat and the person, `none` with person `null`;
//    `new` sends nothing and puts a name field `new-name-<team>-<raceNumber>` in the picker's place, whose commit (its
//    `change` event) sends one `drivers.add { displayName, seat }` (the picker and the field are window-local, C73);
//  - under each linked seat, its person's entries side by side (full mode): a header line ENTRY VALUE LAPS SES NEWEST OVR,
//    per entry a row `entry-row-<person>-<key>` with the value cell `entry-<person>-<key>` (the kit's unknown mark with
//    its reason on hover for an unknown value), its laps, sessions and newest session's day (kit `formatDay`), and an
//    override field `override-<person>-<key>` holding the person's override in the cell's unit (σ lap and mistake in s,
//    sent in ms); a filled override draws the value faint (`textFaint`). A commit of a number sends `drivers.override`
//    with the value in the key's unit, of an empty field `drivers.override.clear`; a rejection (the panel's `send` resolves
//    `{ ok: false, message }`) keeps the draft and shows the message in `warning` (the `warning` role) until the next edit;
//  - per person its sessions in the topic's order (newest first), rows `session-<person>-<i>` with the day, the track
//    (kit `formatTrack`), the phase (kit `formatWeekendPhase`) and the laps, and a toggle `session-toggle-<person>-<i>`
//    (`[x]` kept, `[ ]` excluded) sending `drivers.exclude` or `drivers.include` with the session;
//  - LOBBY: cells `lobby-<GameSettings key>` for safetyCar, redFlags, carDamage, carDamageRate, tyreTemperature,
//    recoveryMode; CONFIG: per unit and key of `config.values` a cell `config-<unit>-<key>`, a key `config.json` set with
//    `ʲ` in the `text` role, the rest `textDim`. Without `session` each LOBBY cell shows a kit unknown mark with a hover;
//    without `config` the CONFIG section is one element `config-unknown` with a kit unknown mark and a hover;
//  - compact: per seat a row `compact-seat-<team>-<raceNumber>`: `#<n>`, the team, the person, its kept sessions and
//    laps (`kept`); an unlinked seat the kit's `notApplicable` mark `–` with a hover.
// `send` comes from the panel (kit `getUiActions`); test/kit/ActionsHarness.svelte stands in for it.
import type { UiAction } from '@pitwall/contracts';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import { unknownMark } from '../../kit/text.ts';
import { formatDay, formatTrack, formatWeekendPhase } from '../../kit/values/format.ts';
import { role } from '../../theme/index.ts';
import DriversPanel from './DriversPanel.svelte';
import { cases, key, KUH, kuh, kuhSessions, LIN, MERCEDES, SESSIONS, type PanelData } from './fixtures.ts';
import { widget } from './widget.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

type Outcome = { ok: true } | { ok: false; reason: 'invalid' | 'notSupported' | 'linkLost'; message?: string };
const accepted = (): Promise<Outcome> => Promise.resolve({ ok: true });
const rejectedWith = (message: string) => (): Promise<Outcome> => Promise.resolve({ ok: false, reason: 'invalid', message });

const SIZES = { compact: { cols: 30, rows: 3 }, full: { cols: 92, rows: 36 } } as const;
type Mode = keyof typeof SIZES;

function mount(data: PanelData, { respond = accepted, mode = 'full' }: { respond?: (a: UiAction) => Promise<Outcome>; mode?: Mode } = {}) {
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
    component: DriversPanel as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size: { mode, ...size, px: { width: size.cols * 8, height: size.rows * 16 }, dpr: 1 }, link: {} },
  });
  return { container, sent };
}

const find = (c: HTMLElement, testId: string): HTMLElement | null => c.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
function get<T extends HTMLElement = HTMLElement>(c: HTMLElement, testId: string): T {
  const el = find(c, testId);
  if (el === null) throw new Error(`no ${testId}`);
  return el as T;
}
const textOf = (c: HTMLElement, testId: string): string => (get(c, testId).textContent ?? '').trim();
async function commit(c: HTMLElement, testId: string, value: string): Promise<void> {
  const field = get<HTMLInputElement>(c, testId);
  await fireEvent.input(field, { target: { value } });
  await fireEvent.change(field, { target: { value } });
}
async function pick(c: HTMLElement, testId: string, value: string): Promise<void> {
  await fireEvent.change(get<HTMLSelectElement>(c, testId), { target: { value } });
}
/** The colour an element shows: its own inline colour or the nearest ancestor's, up to the widget. */
function colourOf(el: HTMLElement | null | undefined, stop: HTMLElement): string {
  for (let e: HTMLElement | null = el ?? null; e !== null && e !== stop.parentElement; e = e.parentElement) {
    if (e.style.color !== '') return e.style.color;
  }
  return '';
}
/** The innermost element of `scope` whose own text, trimmed, is `t`. */
const cellWithText = (scope: HTMLElement, t: string): HTMLElement | undefined =>
  [...scope.querySelectorAll<HTMLElement>('*')].reverse().find((e) => (e.textContent ?? '').trim() === t);
/** The hover on or around an element: its nearest titled ancestor's, or a titled descendant's. */
const hoverOf = (el: HTMLElement): string =>
  el.closest('[title]')?.getAttribute('title') ?? el.querySelector('[title]')?.getAttribute('title') ?? '';
const UNKNOWN_MARKS: string[] = Object.values(unknownMark);

/** Every visible text node of the widget, trimmed, without empty ones. */
function visibleTexts(c: HTMLElement): string[] {
  const walker = c.ownerDocument.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = (n.textContent ?? '').trim();
    if (t !== '' && n.parentElement?.closest('option, script, style') === null) out.push(t);
  }
  return out;
}

const seat12 = `${MERCEDES}-12`;
const seat63 = `${MERCEDES}-63`;

describe('drivers-panel', () => {
  it('two seats side by side: #12 Mercedes → kuh ▾; the picker lists the persons, new and none; a pick sends drivers.link, none sends person null; new opens a name field that sends one drivers.add { displayName, seat }', async () => {
    let { container: c, sent } = mount(cases.twoSeats);
    const s12 = get(c, `seat-${seat12}`);
    const s63 = get(c, `seat-${seat63}`);
    for (const part of ['#12', 'Mercedes', '→']) expect(s12.textContent, part).toContain(part);
    for (const part of ['#63', 'Mercedes', '→']) expect(s63.textContent, part).toContain(part);
    // by race number: #12 first
    expect(s12.compareDocumentPosition(s63) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const picker = get<HTMLSelectElement>(c, `link-${seat12}`);
    expect(picker.value).toBe(KUH);
    expect(get<HTMLSelectElement>(c, `link-${seat63}`).value).toBe(LIN);
    expect([...picker.options].map((o) => o.value)).toEqual([KUH, LIN, ':new', ':none']);
    expect([...picker.options].map((o) => o.textContent?.trim())).toEqual(['kuh', 'lin', 'new', 'none']);

    await pick(c, `link-${seat12}`, LIN);
    expect(sent).toEqual([{ kind: 'drivers.link', team: MERCEDES, raceNumber: 12, person: LIN }]);
    cleanup();

    ({ container: c, sent } = mount(cases.twoSeats));
    await pick(c, `link-${seat63}`, ':none');
    expect(sent).toEqual([{ kind: 'drivers.link', team: MERCEDES, raceNumber: 63, person: null }]);
    cleanup();

    ({ container: c, sent } = mount(cases.twoSeats));
    expect(find(c, `new-name-${seat63}`)).toBeNull();
    await pick(c, `link-${seat63}`, ':new');
    expect(sent).toEqual([]);
    expect(find(c, `link-${seat63}`)).toBeNull();
    await commit(c, `new-name-${seat63}`, 'kai');
    expect(sent).toEqual([{ kind: 'drivers.add', displayName: 'kai', seat: { team: MERCEDES, raceNumber: 63 } }]);
  });

  it('per person its entries: ENTRY VALUE LAPS SES NEWEST OVR; a filled override makes the value faint; an override sends drivers.override, an empty field drivers.override.clear; a rejection keeps the draft and shows the message in warning', async () => {
    let { container: c, sent } = mount(cases.twoSeats);
    expect(c.textContent).toMatch(/ENTRY\s+VALUE\s+LAPS\s+SES\s+NEWEST\s+OVR/);
    // the mockup's values of kuh, with the laps, sessions and newest day they rest on
    const shown: [string, string, string, string, string][] = [
      [key.sigma, '0.412', '214', '5', '2026-11-08'],
      [key.rho, '0.31', '214', '5', '2026-11-08'],
      [key.mistakeRate, '0.024', '214', '5', '2026-11-08'],
      [key.mistakeMedian, '1.9', '214', '5', '2026-11-08'],
      [key.mistakeSigmaLog, '0.55', '214', '5', '2026-11-08'],
      [key.wear('soft'), '3.1', '22', '2', '2026-11-07'],
      [key.wear('medium'), '2.2', '118', '4', '2026-11-08'],
      [key.wear('hard'), '1.6', '74', '3', '2026-11-01'],
    ];
    for (const [k, value, laps, ses, newest] of shown) {
      expect(textOf(c, `entry-${KUH}-${k}`), k).toBe(value);
      const row = get(c, `entry-row-${KUH}-${k}`).textContent ?? '';
      expect(row, k).toMatch(new RegExp(`\\b${laps}\\s+${ses}\\s+${formatDay(newest)}`));
    }
    // lin's soft wear is unknown: the kit's mark with the reason on hover
    const softLin = get(c, `entry-${LIN}-${key.wear('soft')}`);
    expect(softLin.textContent?.trim()).toBe(unknownMark.insufficientData);
    expect(hoverOf(softLin)).not.toBe('');
    // kuh's σ lap carries an override (380 ms, shown 0.380 s): its value faint, its field filled
    expect(get<HTMLInputElement>(c, `override-${KUH}-${key.sigma}`).value).toBe('0.380');
    expect(colourOf(cellWithText(get(c, `entry-${KUH}-${key.sigma}`), '0.412'), c)).toBe(role('textFaint'));
    expect(colourOf(cellWithText(get(c, `entry-${KUH}-${key.rho}`), '0.31'), c)).not.toBe(role('textFaint'));
    expect(get<HTMLInputElement>(c, `override-${KUH}-${key.rho}`).value).toBe('');

    // an override in s is sent in ms; one without a unit as typed
    await commit(c, `override-${KUH}-${key.sigma}`, '0.395');
    await commit(c, `override-${LIN}-${key.mistakeRate}`, '0.03');
    expect(sent).toHaveLength(2);
    const [sigma, rate] = sent as Extract<UiAction, { kind: 'drivers.override' }>[];
    expect({ ...sigma, value: undefined }).toEqual({ kind: 'drivers.override', person: KUH, key: key.sigma, value: undefined });
    expect(sigma?.value).toBeCloseTo(395, 6);
    expect(rate).toEqual({ kind: 'drivers.override', person: LIN, key: key.mistakeRate, value: 0.03 });
    cleanup();

    // emptying a filled field clears the override
    ({ container: c, sent } = mount(cases.twoSeats));
    await commit(c, `override-${KUH}-${key.sigma}`, '');
    expect(sent).toEqual([{ kind: 'drivers.override.clear', person: KUH, key: key.sigma }]);
    cleanup();

    // a rejection keeps the draft and shows the bridge's message in the warning role, until the next edit
    const message = 'mistake/lap 0 to 0.2';
    ({ container: c, sent } = mount(cases.twoSeats, { respond: rejectedWith(message) }));
    const field = `override-${LIN}-${key.mistakeRate}`;
    await commit(c, field, '0.4');
    expect(sent).toHaveLength(1);
    await vi.waitFor(() => expect(find(c, 'warning')?.textContent).toContain(message));
    expect(colourOf(cellWithText(get(c, 'warning'), get(c, 'warning').textContent?.trim() ?? ''), c)).toBe(role('warning'));
    expect(get<HTMLInputElement>(c, field).value).toBe('0.4');
    await fireEvent.input(get<HTMLInputElement>(c, field), { target: { value: '0.04' } });
    expect(find(c, 'warning')?.textContent ?? '').not.toContain(message);
  });

  it('per person its sessions newest first with [x]/[ ] toggles sending drivers.exclude / drivers.include; the session label from formatWeekendPhase (FP2, Q1, race, as drivers-panel.html)', async () => {
    const { container: c, sent } = mount(cases.twoSeats);
    expect(kuhSessions.map((s) => formatWeekendPhase(s.phase))).toEqual(['Q1', 'FP2', 'race', 'FP2', 'race', 'race']);
    kuhSessions.forEach((s, i) => {
      const row = get(c, `session-${KUH}-${i}`).textContent ?? '';
      for (const part of [formatDay(s.date), formatTrack(s.trackId), formatWeekendPhase(s.phase), String(s.laps)]) expect(row, `${i} ${part}`).toContain(part);
      expect(textOf(c, `session-toggle-${KUH}-${i}`), `${i}`).toBe(s.excluded ? '[ ]' : '[x]');
    });
    // newest first, in the topic's order: the row of the Spa Q1 before the row of the Texas race
    const first = get(c, `session-${KUH}-0`);
    const last = get(c, `session-${KUH}-5`);
    expect(first.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(find(c, `session-${KUH}-6`)).toBeNull();
    expect(find(c, `session-${LIN}-3`)).not.toBeNull();

    await fireEvent.click(get(c, `session-toggle-${KUH}-0`));
    await fireEvent.click(get(c, `session-toggle-${KUH}-4`));
    expect(sent).toEqual([
      { kind: 'drivers.exclude', person: KUH, session: SESSIONS.spaQ1 },
      { kind: 'drivers.include', person: KUH, session: SESSIONS.zandvoortRace },
    ]);
  });

  it('LOBBY from session.info\'s settings (safety car, red flags, car damage, damage rate, tyre temp, recovery) and CONFIG per unit and key, config.json values with ʲ in text, the rest textDim', () => {
    const { container: c } = mount(cases.twoSeats);
    const all = c.textContent ?? '';
    for (const label of ['LOBBY', 'CONFIG', 'safety car', 'red flags', 'car damage', 'damage rate', 'tyre temp', 'recovery']) expect(all, label).toContain(label);
    const lobby: [string, string][] = [
      ['safetyCar', 'standard'], ['redFlags', 'standard'], ['carDamage', 'standard'], ['carDamageRate', 'standard'],
      ['tyreTemperature', 'surface + carcass'], ['recoveryMode', 'none'],
    ];
    for (const [k, word] of lobby) expect(textOf(c, `lobby-${k}`), k).toBe(word);

    for (const header of ['UNIT', 'KEY', 'VALUE', 'strategy', 'battle', 'neighbourMinLaps', 'rivalScBoxChance', 'drsRangeMs']) expect(all, header).toContain(header);
    const defaults: [string, string][] = [
      ['strategy-neighbourMinLaps', '1'], ['strategy-rivalScBoxChance', '0.88'], ['strategy-rivalScMinTyreAge', '4'], ['strategy-rivalReactionLaps', '0'],
    ];
    for (const [id, v] of defaults) {
      const cell = get(c, `config-${id}`);
      expect(cell.textContent?.trim(), id).toBe(v);
      expect(colourOf(cellWithText(cell, v) ?? cell, c), id).toBe(role('textDim'));
    }
    const set: [string, string][] = [['strategy-neighbourMaxLaps', '2'], ['battle-drsRangeMs', '1200']];
    for (const [id, v] of set) {
      const cell = get(c, `config-${id}`);
      expect(cell.textContent?.replace(/\s/g, ''), id).toBe(`${v}ʲ`);
      expect(colourOf(cellWithText(cell, v) ?? cell, c), id).toBe(role('text'));
      expect(hoverOf(cell), id).not.toBe('');
    }
    // only the keys config.json set carry the mark
    expect(all.match(/ʲ/g)).toHaveLength(2);
  });

  it('compact: per seat the person, kept sessions and laps; an unlinked seat –', () => {
    let { container: c } = mount(cases.twoSeats, { mode: 'compact' });
    expect(c.textContent).toMatch(/SES\s+LAPS/);
    expect(get(c, `compact-seat-${seat12}`).textContent).toMatch(/#12\s+Mercedes\s+kuh\s+5\s+214/);
    expect(get(c, `compact-seat-${seat63}`).textContent).toMatch(/#63\s+Mercedes\s+lin\s+4\s+166/);
    // compact mode drops the controls and the sections
    for (const id of [`link-${seat12}`, `override-${KUH}-${key.sigma}`, `session-toggle-${KUH}-0`, 'lobby-safetyCar']) expect(find(c, id), id).toBeNull();
    cleanup();

    ({ container: c } = mount(cases.unlinkedSeat, { mode: 'compact' }));
    const row = get(c, `compact-seat-${seat63}`);
    expect(row.textContent).toMatch(/#63\s+Mercedes\s+–/);
    expect(row.textContent).not.toContain('lin');
    const mark = cellWithText(row, unknownMark.notApplicable);
    expect(mark).toBeDefined();
    expect(hoverOf(mark as HTMLElement)).not.toBe('');
  });

  it('no session: seats from links and the stored unlinked slots; LOBBY and CONFIG the kit\'s unknown marks; the profiles still shown', () => {
    const { container: c } = mount(cases.noSession);
    // #12 from its link, #63 once from its two stored unlinked slots
    expect(c.querySelectorAll(`[data-testid="seat-${seat12}"]`)).toHaveLength(1);
    expect(c.querySelectorAll(`[data-testid="seat-${seat63}"]`)).toHaveLength(1);
    expect(get(c, `seat-${seat63}`).textContent).toContain('Mercedes');
    expect(get<HTMLSelectElement>(c, `link-${seat12}`).value).toBe(KUH);
    expect(get<HTMLSelectElement>(c, `link-${seat63}`).value).toBe(':none');
    for (const k of ['safetyCar', 'redFlags', 'carDamage', 'carDamageRate', 'tyreTemperature', 'recoveryMode']) {
      const cell = get(c, `lobby-${k}`);
      expect(UNKNOWN_MARKS, k).toContain(cell.textContent?.trim());
      expect(hoverOf(cell), k).not.toBe('');
    }
    const config = get(c, 'config-unknown');
    expect(UNKNOWN_MARKS).toContain(config.textContent?.trim());
    expect(hoverOf(config)).not.toBe('');
    expect(c.querySelector('[data-testid^="config-strategy"]')).toBeNull();
    // kuh's profile and sessions are shown as with a session
    expect(textOf(c, `entry-${KUH}-${key.sigma}`)).toBe('0.412');
    expect(textOf(c, `session-toggle-${KUH}-0`)).toBe('[x]');
    expect(kuh.sessions).toHaveLength(6);
  });

  it('the panel never imports a unit\'s defaults', () => {
    // C1 (depcruise `ui-only-contracts-domain`, existing): the panel's sources import nothing of the analysis or the
    // engine; the config values come from `config.effective` only.
    const sources = import.meta.glob<string>(['./*.ts', './*.svelte', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources)).toEqual(expect.arrayContaining(['./DriversPanel.svelte', './widget.ts']));
    for (const [file, src] of Object.entries(sources)) {
      expect(src, file).not.toMatch(/from\s+['"]@pitwall\/(analysis|engine)/);
      expect(src, file).not.toMatch(/packages\/(analysis|engine)\//);
    }
    // and the stub is gone: the panel renders the sample
    expect(() => mount(cases.twoSeats)).not.toThrow();
  });

  it('no sentence in the visible text', () => {
    // numbers, shapes, headers, words of settings, names and keys only (memory "no explaining text"); hovers may be phrases
    const sentence = /(?:\b[a-z]{2,}\b[\s,]+){3}\b[a-z]{2,}\b/;
    for (const [name, data] of Object.entries(cases)) {
      for (const mode of ['full', 'compact'] as const) {
        const { container: c } = mount(data, { mode });
        const texts = visibleTexts(c);
        expect(texts.length, `${name} ${mode}`).toBeGreaterThan(0);
        for (const t of texts) expect(t, `${name} ${mode}`).not.toMatch(sentence);
        cleanup();
      }
    }
  });
});

// SP4.3b2 Task 18v: the display against its approved mockup (drivers-panel.html, the picker ` kuh ▾`). The overflow of
// full/unlinkedSeat and full/noSession is covered by fit.spec (Playwright).
describe('drivers-panel against the mockup (Task 18v)', () => {
  /** The mockup's small picker arrow, and the large one the browser's own picker icon draws. */
  const SMALL_ARROW = '▾';
  const LARGE_ARROW = '▼';

  it('the person picker shows the small ▾ of the mockup, never the large ▼', () => {
    for (const [name, data] of [['twoSeats', cases.twoSeats], ['unlinkedSeat', cases.unlinkedSeat]] as const) {
      const { container: c } = mount(data);
      for (const seat of [seat12, seat63]) {
        const shown = visibleTexts(get(c, `seat-${seat}`)).join(' ');
        expect(shown, `${name} ${seat}`).toContain(SMALL_ARROW);
        expect(shown, `${name} ${seat}`).not.toContain(LARGE_ARROW);
      }
      cleanup();
    }
  });
});
