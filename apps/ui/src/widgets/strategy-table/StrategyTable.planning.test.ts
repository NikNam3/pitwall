// @vitest-environment jsdom
// The strategy table in the planning round (SP4.3d2 Task 12; SP4.3d spec §7.4; plan-workbook.html "Planning round": the
// table below each board shows the planning job's ranking, `plans.preview`; C65, C66). Contract assumed:
//  - `source.ts` `variantOf(source: 'auto' | 'live' | 'planning', prepared: PlanningRound | undefined): 'live' | 'planning'`:
//    `live` and `planning` as chosen; `auto` planning while `prepared.open`, live when closed or without the topic's
//    value (the board's rule, plan-board `presentation.ts`; the table reads no sub-machine, so it holds no
//    presentation.ts, test/presentation-completeness.test.ts);
//  - `StrategyTable.svelte` draws `preview` in the planning variant and `plan` in the live one, the same way (the list
//    `row-<i>`, the chart's `line-<i>`, the footer `N <scenarios>`); in the planning variant without a preview value:
//    nothing drawn (the job computing); outside the round with `source: planning`: the kit's notApplicable mark.
// Needs `source.ts` and the planning variant of `StrategyTable.svelte` (implementation): fails until then.
import type { UiAction } from '@pitwall/contracts';
import { carId, feedId } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionsHarness from '../../../test/kit/ActionsHarness.svelte';
import { unknownMark } from '../../kit/text.ts';
import type { ResolvedLink } from '../../kit/types.ts';
import { formatCount } from '../../kit/values/format.ts';
import { CLOSED, PLANNING, ROUND, cases, preview } from './fixtures.ts';
import { stopsText } from './rows.ts';
import { variantOf } from './source.ts';
import StrategyTable from './StrategyTable.svelte';
import { widget } from './widget.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const SIZE = { mode: 'full', cols: 88, rows: 13, px: { width: 88 * 8, height: 13 * 19.6 }, dpr: 1 } as const;
const LINK: ResolvedLink = { group: 1, feedId: feedId('20778'), primary: carId(0), compare: [], window: { kind: 'live' } };

type Source = 'auto' | 'live' | 'planning';

function mount(data: Record<string, unknown>, source: Source) {
  vi.stubEnv('DEV', true);
  vi.stubEnv('PROD', false);
  const props = (d: Record<string, unknown>) => ({ data: d, options: { source }, size: SIZE, link: LINK });
  const { container, rerender } = render(ActionsHarness, {
    send: (_: UiAction) => Promise.resolve({ ok: true }),
    actions: widget.actions,
    component: StrategyTable as unknown as Component<Record<string, unknown>>,
    widgetProps: props(data),
  });
  return { container, update: (d: Record<string, unknown>) => rerender({ widgetProps: props(d) }) };
}

const rows = (c: Element): Element[] => [...c.querySelectorAll('[data-testid^="row-"]')];
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('strategy table: the source', () => {
  it('variantOf: auto planning while the round is open, live after; live and planning as chosen', () => {
    expect(variantOf('auto', ROUND)).toBe('planning');
    expect(variantOf('auto', CLOSED)).toBe('live');
    expect(variantOf('auto', undefined)).toBe('live');
    for (const prepared of [ROUND, CLOSED, undefined]) {
      expect(variantOf('live', prepared)).toBe('live');
      expect(variantOf('planning', prepared)).toBe('planning');
    }
  });
});

describe('strategy table: the planning variant renders plans.preview', () => {
  it('the planning job\'s ranking: its rows, its stops, its runs; not the race\'s', () => {
    const { container: c } = mount(cases.planning, 'planning');
    expect(rows(c)).toHaveLength(PLANNING.rows.length);
    expect(textOf(rows(c)[0] ?? null)).toContain(stopsText(PLANNING.rows[0]!.policy));
    expect(c.querySelectorAll('[data-testid^="line-"]')).toHaveLength(PLANNING.rows.length);
    expect(textOf(c.querySelector('[data-testid="footer"]'))).toContain(formatCount(PLANNING.scenarios));
  });

  it('auto: the preview while the round is open, the race\'s table after', async () => {
    const { container: c, update } = mount(cases.planning, 'auto');
    expect(rows(c)).toHaveLength(PLANNING.rows.length);
    await update({ ...cases.planning, prepared: CLOSED });
    expect(rows(c)).toHaveLength(8);
  });

  it('planning without a preview yet: nothing drawn; outside the round: the kit\'s notApplicable mark', () => {
    const { container: c } = mount({ plan: cases.planning.plan, prepared: ROUND }, 'planning');
    expect(rows(c)).toHaveLength(0);
    expect(textOf(c)).toBe('');
    cleanup();
    const { container: c2 } = mount({ plan: cases.planning.plan, preview: preview(), prepared: CLOSED }, 'planning');
    expect(rows(c2)).toHaveLength(0);
    expect(textOf(c2)).toBe(unknownMark.notApplicable);
  });
});
