// The strategy table's rows (SP4.3b spec §10; mockup strategy-table-b.html; Q1 A; P27; C65: every rank, tie, Δ and
// flag is the topic's, the rows format and map them). Contract assumed of `rows.ts` (`PlanTable` = the known value of
// `strategy.car`):
//  - `stopsText(policy)`: each stop `L20 H` (kit `formatLapNumber(lap, 2)`, the kit compound letter), joined by a space;
//  - `listRows(plan): ListRow[]`, one per row in topic order: `bracket` null unless the row `tie`s, else `first`/`last`
//    at its group's ends, role `warning` with `text.openTieHover` while `unresolvedTie`, else `textDim` with
//    `text.tieHover`; `rank` the row's `rank`; `source` the word `text.source[row.source]` (`plan` for the committed row)
//    with hover `text.sourceHover[source]`, for a rule candidate `text.sourceHover.rule(row.rule)`; `stops`; `ePos` kit
//    `formatExpectedPlace`; `committed`; `infeasible` `text.infeasible[row.infeasible]` or null;
//  - `infoRow(plan, i)`: rank, source (as the list), stops, `ePos`, `ePoints` (kit `formatPoints`), `delta`: without a
//    commit kit `formatSignedSeconds(deltaLeaderMs, 1)`, empty on rows[0]; with a commit
//    `formatSignedSeconds(deltaPlanMs, 1)`, empty on the committed row; `button` `clear` on the committed row, else
//    `commit`. A policy is a stop list (SP4.3d spec §5.1): the TRG count, the trigger lines (`triggerTexts`) and the
//    rivals' race numbers (`cars`) are deleted with the triggers (SP4.3d1 Task 3);
//  - `deltaHeader(plan)`: `text.headers.dLead` (`ΔTIME`) without a committed row, `text.headers.dPlan` (`ΔPLAN`) with one;
//  - `footer(plan)`: `n` the scenario count (kit `formatCount`), `warning` with `text.openTieHover` while `unresolvedTie`,
//    else no warning; `cand` the candidate count.
import { type McRow } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { formatCount, formatExpectedPlace, formatPoints, formatSignedSeconds } from '../../kit/values/format.ts';
import { COMMITTED, NO_HIGHLIGHT, OPEN_TIE, table } from './fixtures.ts';
import * as rowsModule from './rows.ts';
import { deltaHeader, footer, infoRow, listRows, stopsText } from './rows.ts';
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

  it('the info rows: rank, source, stops, E[pos], E[points], the button', () => {
    const i = at(NO_HIGHLIGHT.rows, 'L20 H');
    const r = NO_HIGHLIGHT.rows[i]!;
    expect(infoRow(NO_HIGHLIGHT, i)).toEqual({
      rank: String(r.rank),
      source: { text: 'dp', hover: text.sourceHover.dp },
      stops: 'L20 H',
      ePos: formatExpectedPlace(r.ePos),
      ePoints: formatPoints(r.ePoints),
      delta: i === 0 ? '' : formatSignedSeconds(r.deltaLeaderMs, 1),
      button: 'commit',
    });
    const k = COMMITTED.rows.findIndex((x) => x.committed);
    expect(infoRow(COMMITTED, k)).toMatchObject({ source: { text: 'plan', hover: text.sourceHover.committed }, button: 'clear' });
    expect(listRows(COMMITTED)[k]).toMatchObject({ committed: true, source: { text: 'plan' } });
  });

  // SP4.3d1 Task 3 row 5 (spec §5.1): the TRG column and its trigger lines are deleted with the triggers
  it('strategy table: no TRG column; rows render without triggers', () => {
    expect(Object.keys(text.headers)).not.toContain('trg');
    expect(Object.values(text.headers)).not.toContain('TRG');
    expect('trigger' in text, 'no trigger wording').toBe(false);
    expect('triggerTexts' in rowsModule, 'no trigger lines').toBe(false);
    for (const plan of [NO_HIGHLIGHT, COMMITTED, OPEN_TIE]) {
      plan.rows.forEach((r, i) => {
        expect(Object.keys(r.policy), `row ${i}`).toEqual(['stops']);
        expect(Object.keys(r), `row ${i}`).not.toContain('triggers');
        const info = infoRow(plan, i);
        expect(Object.keys(info), `row ${i}`).not.toContain('trg');
        expect(Object.keys(info), `row ${i}`).not.toContain('triggers');
        expect(info.stops, `row ${i}`).toBe(stopsText(r.policy));
      });
    }
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
    const rules = (['mirrorAhead', 'mirrorBehind'] as const).map((r) => text.sourceHover.rule(r));
    expect(new Set(rules).size).toBe(2);
    for (const h of rules) expect(h.length).toBeGreaterThan(0);
    const others = (['dp', 'neighbour', 'committed'] as const).map((s) => text.sourceHover[s]);
    expect(others.every((h) => h.length > 0 && !rules.includes(h))).toBe(true);
  });
});

// SP4.3c Task 22b (T5, R61): what a "stay out" means on screen. A policy with no stops reads `text.toTheFlag` in STOPS
// (list and detail rows). SP4.3d1 Task 3: the stay-out trigger's wording (`not this lap`) is deleted with the triggers.
describe('strategy-table stay-out wording', () => {
  it('the word lives in text.ts', () => {
    expect(text.toTheFlag).toBe('to the flag');
  });

  it('a zero-stop policy shows "to the flag" in STOPS, in the list and in the detail row', () => {
    const base = NO_HIGHLIGHT;
    const i = 2;
    const rows = base.rows.map((r, j) => (j === i ? { ...r, policy: { ...r.policy, stops: [] } } : r));
    const plan = { ...base, rows };
    expect(listRows(plan)[i]!.stops).toBe(text.toTheFlag);
    expect(infoRow(plan, i).stops).toBe(text.toTheFlag);
    // the other rows keep their stops
    expect(listRows(plan)[0]!.stops).toBe(stopsText(base.rows[0]!.policy));
    expect(listRows(plan)[0]!.stops).not.toBe(text.toTheFlag);
  });
});
