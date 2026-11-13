// The strategy table's rows (SP4.3b spec §10; mockup strategy-table-b.html; Q1 A; P27; C65: every rank, tie, Δ and
// flag is the topic's, the rows format and map them). Contract assumed of `rows.ts` (`PlanTable` = the known value of
// `strategy.car`):
//  - `stopsText(policy)`: each stop `L20 H` (kit `formatLapNumber(lap, 2)`, the kit compound letter), joined by a space;
//  - `listRows(plan): ListRow[]`, one per row in topic order: `bracket` null unless the row `tie`s, else `first`/`last`
//    at its group's ends, role `warning` with `text.openTieHover` while `unresolvedTie`, else `textDim` with
//    `text.tieHover`; `rank` the row's `rank`; `source` the word `text.source[row.source]` (`plan` for the committed row)
//    with hover `text.sourceHover[source]`, for a rule candidate `text.sourceHover.rule(row.rule)`; `stops`; `ePos` kit
//    `formatExpectedPlace`; `committed`; `infeasible` `text.infeasible[row.infeasible]` or null;
//  - `infoRow(plan, i)`: rank, source (as the list), stops, `trg` the count `policy.triggers.length`, `ePos`, `ePoints`
//    (kit `formatPoints`), `delta`: without a commit kit `formatSignedSeconds(deltaLeaderMs, 1)`, empty on rows[0]; with
//    a commit `formatSignedSeconds(deltaPlanMs, 1)`, empty on the committed row; `button` `clear` on the committed row,
//    else `commit`; `triggers` = `triggerTexts(policy.triggers)`;
//  - `deltaHeader(plan)`: `text.headers.dLead` (`ΔTIME`) without a committed row, `text.headers.dPlan` (`ΔPLAN`) with one;
//  - `footer(plan)`: `n` the scenario count (kit `formatCount`), `warning` with `text.openTieHover` while `unresolvedTie`,
//    else no warning; `cand` the candidate count;
//  - `triggerTexts(triggers)`: one text per trigger in policy order (`text.trigger[kind]`), an SC and a VSC trigger with
//    the same range joined as one `SC/VSC L12–24` at the first one's place.
import { carId, type McRow, type Trigger } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { formatCount, formatExpectedPlace, formatPoints, formatSignedSeconds } from '../../kit/values/format.ts';
import { COMMITTED, NO_HIGHLIGHT, OPEN_TIE, table } from './fixtures.ts';
import { deltaHeader, footer, infoRow, listRows, stopsText, triggerTexts } from './rows.ts';
import * as text from './text.ts';

const at = (rows: McRow[], stops: string): number => rows.findIndex((r) => r.policy.stops.map((s) => `L${s.lap} ${s.compound[0]!.toUpperCase()}`).join(' ') === stops);

describe('strategy-table rows', () => {
  it('the list: bracket over the tied rows, rank, source word, stops L20 H, E[pos]', () => {
    const rows = NO_HIGHLIGHT.rows;
    const list = listRows(NO_HIGHLIGHT);
    expect(list.map((r) => r.rank)).toEqual(rows.map((r) => String(r.rank)));
    expect(list.slice(0, 4).map((r) => r.rank)).toEqual(['1', '1', '1', '4']);
    expect(list.map((r) => r.stops)).toEqual(rows.map((r) => stopsText(r.policy)));
    expect(list[at(rows, 'L20 H')]!.stops).toBe('L20 H');
    expect(list[at(rows, 'L16 H L31 M')]!.stops).toBe('L16 H L31 M');
    expect(list.map((r) => r.ePos)).toEqual(rows.map((r) => formatExpectedPlace(r.ePos)));
    expect(list.map((r) => r.source.text)).toEqual(rows.map((r) => ({ dp: 'dp', neighbour: 'nbr', rule: 'rule', committed: 'plan' })[r.source]));
    expect(list.map((r) => r.bracket === null)).toEqual(rows.map((r) => !r.tie));
    expect(list.slice(0, 3).map((r) => [r.bracket?.first, r.bracket?.last])).toEqual([[true, false], [false, false], [false, true]]);
    expect(list[0]!.bracket).toMatchObject({ role: 'textDim', hover: text.tieHover });
    expect(list.every((r) => r.infeasible === null)).toBe(true);
  });

  it('the info rows: rank, source, stops, TRG count, E[pos], E[points], the button, then the triggers', () => {
    const i = at(NO_HIGHLIGHT.rows, 'L20 H');
    const r = NO_HIGHLIGHT.rows[i]!;
    expect(infoRow(NO_HIGHLIGHT, i)).toEqual({
      rank: String(r.rank),
      source: { text: 'dp', hover: text.sourceHover.dp },
      stops: 'L20 H',
      trg: String(r.policy.triggers.length),
      ePos: formatExpectedPlace(r.ePos),
      ePoints: formatPoints(r.ePoints),
      delta: i === 0 ? '' : formatSignedSeconds(r.deltaLeaderMs, 1),
      button: 'commit',
      triggers: ['SC/VSC L12–24', 'DMG +1.2 s/lap', 'DEG +30%'],
    });
    const k = COMMITTED.rows.findIndex((x) => x.committed);
    expect(infoRow(COMMITTED, k)).toMatchObject({ source: { text: 'plan', hover: text.sourceHover.committed }, button: 'clear' });
    expect(listRows(COMMITTED)[k]).toMatchObject({ committed: true, source: { text: 'plan' } });
  });

  it('ΔTIME without a commit, ΔPLAN with one; an unresolved tie amber with the footer\'s N', () => {
    expect(deltaHeader(NO_HIGHLIGHT)).toBe('ΔTIME');
    expect(deltaHeader(COMMITTED)).toBe('ΔPLAN');
    // without a commit: against the leader, rows[0] blank
    expect(infoRow(NO_HIGHLIGHT, 0).delta).toBe('');
    NO_HIGHLIGHT.rows.forEach((r, i) => {
      if (i > 0) expect(infoRow(NO_HIGHLIGHT, i).delta, `row ${i}`).toBe(formatSignedSeconds(r.deltaLeaderMs, 1));
    });
    // with a commit: against the plan, the committed row blank (Q1 A)
    const k = COMMITTED.rows.findIndex((r) => r.committed);
    expect(infoRow(COMMITTED, k).delta).toBe('');
    COMMITTED.rows.forEach((r, i) => {
      if (i !== k) expect(infoRow(COMMITTED, i).delta, `row ${i}`).toBe(formatSignedSeconds(r.deltaPlanMs!, 1));
    });
    expect(infoRow(COMMITTED, 0).delta).not.toBe(formatSignedSeconds(COMMITTED.rows[0]!.deltaLeaderMs, 1));
    // an open tie at the cap: the bracket and N amber
    const open = listRows(OPEN_TIE);
    expect(open.filter((r) => r.bracket !== null)).toHaveLength(2);
    for (const r of open.slice(0, 2)) expect(r.bracket).toMatchObject({ role: 'warning', hover: text.openTieHover });
    expect(footer(OPEN_TIE)).toEqual({ n: { text: formatCount(OPEN_TIE.scenarios), role: 'warning', hover: text.openTieHover }, cand: formatCount(OPEN_TIE.candidates) });
    const plain = footer(NO_HIGHLIGHT);
    expect(plain.n.text).toBe(formatCount(NO_HIGHLIGHT.scenarios));
    expect(plain.n.role).not.toBe('warning');
    expect(plain.cand).toBe(formatCount(14));
  });

  it('an infeasible committed row carries its reason for the hover', () => {
    const plan = table({ committed: 'L14 H', infeasible: 'noSetLeft' });
    const k = plan.rows.findIndex((r) => r.committed);
    expect(listRows(plan)[k]!.infeasible).toBe(text.infeasible.noSetLeft);
    expect(text.infeasible.stopLapPassed).not.toBe(text.infeasible.noSetLeft);
  });

  it('SRC rule shows the rule\'s name on hover from text.ts', () => {
    const i = NO_HIGHLIGHT.rows.findIndex((r) => r.source === 'rule');
    expect(NO_HIGHLIGHT.rows[i]!.rule).toBe('mirrorAhead');
    expect(listRows(NO_HIGHLIGHT)[i]!.source).toEqual({ text: 'rule', hover: text.sourceHover.rule('mirrorAhead') });
    expect(infoRow(NO_HIGHLIGHT, i).source).toEqual({ text: 'rule', hover: text.sourceHover.rule('mirrorAhead') });
    const rules = (['mirrorAhead', 'mirrorBehind', 'cover', 'extend'] as const).map((r) => text.sourceHover.rule(r));
    expect(new Set(rules).size).toBe(4);
    for (const h of rules) expect(h.length).toBeGreaterThan(0);
    const others = (['dp', 'neighbour', 'committed'] as const).map((s) => text.sourceHover[s]);
    expect(others.every((h) => h.length > 0 && !rules.includes(h))).toBe(true);
  });
});

/** Every `Trigger['kind']`, checked both ways against the type. */
const KINDS = ['neutralised', 'rain', 'rivalPits', 'degradationOff', 'damage'] as const satisfies readonly Trigger['kind'][];
type Missing = Exclude<Trigger['kind'], (typeof KINDS)[number]>;
const allKinds: Missing extends never ? true : false = true;

describe('strategy-table trigger wording', () => {
  it('every Trigger kind has its wording; SC and VSC with one range join as SC/VSC', () => {
    expect(allKinds).toBe(true);
    expect(Object.keys(text.trigger).sort()).toEqual([...KINDS].sort());
    const sc = (from: number, to: number): Trigger => ({ kind: 'neutralised', condition: 'sc', fromLap: from, toLap: to, action: { box: 'hard' } });
    const vsc = (from: number, to: number): Trigger => ({ kind: 'neutralised', condition: 'vsc', fromLap: from, toLap: to, action: 'stayOut' });
    expect(triggerTexts([sc(12, 24)])).toEqual(['SC L12–24']);
    expect(triggerTexts([vsc(15, 24)])).toEqual(['VSC L15–24']);
    expect(triggerTexts([sc(12, 24), vsc(15, 24)])).toEqual(['SC L12–24', 'VSC L15–24']);
    expect(triggerTexts([sc(12, 24), vsc(12, 24)])).toEqual(['SC/VSC L12–24']);
    expect(triggerTexts([{ kind: 'damage', lossMsPerLap: 1_200, action: { box: 'hard' } }])).toEqual(['DMG +1.2 s/lap']);
    expect(triggerTexts([{ kind: 'degradationOff', wearRateDeltaPct: 30, action: { switchTo: [{ lap: 18, compound: 'hard' }] } }])).toEqual(['DEG +30%']);
    expect(triggerTexts([{ kind: 'rain', wetnessMs: 800, action: { box: 'inter' } }])).toEqual(['RAIN +0.8 s']);
    expect(triggerTexts([{ kind: 'rivalPits', carId: carId(44), withinMs: 1_000, action: 'cover' }])).toEqual(['COVER #44 1.0 s']);
    expect(triggerTexts([{ kind: 'rivalPits', carId: carId(44), withinMs: 1_000, action: 'extend' }])).toEqual(['EXT #44 1.0 s']);
    // the joined pair keeps the first one's place
    expect(triggerTexts([{ kind: 'damage', lossMsPerLap: 1_200, action: { box: 'hard' } }, vsc(12, 24), sc(12, 24)])).toEqual(['DMG +1.2 s/lap', 'SC/VSC L12–24']);
  });
});
