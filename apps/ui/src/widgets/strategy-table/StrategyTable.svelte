<script lang="ts">
  // The strategy table, variant B (SP4.3b spec §10; mockup docs/design/2026-11-12-sp4.3b/strategy-table-b.html; Q7 A,
  // Q9 B, Q10 B): every ranked policy's place distribution on one chart, the list beside it, the highlighted policy's
  // info rows below with "save to slot …" (a slot picker), activate on a saved row or clear on the committed one (full
  // only; SP4.3d1 Task 11). Every number is `strategy`'s; rows.ts and chart.ts format and place them (C65). The
  // highlight and the picker are window-local (C73); save, activate and clear go through the panel (C74).
  import { PLAN_SLOTS, type McRow, type Slot } from '@pitwall/domain';
  import { getUiActions } from '../../kit/actions.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role } from '../../theme/index.ts';
  import StrategyChart from './StrategyChart.svelte';
  import { deltaHeader, footer, infoRow, listRows, type PlanTable } from './rows.ts';
  import { variantOf } from './source.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, options, size, link }: WidgetProps<typeof widget> = $props();
  const { send } = getUiActions();

  /** Cells of the list beside the chart (bracket, #, SRC, STOPS, E[POS] and their gaps, gen.mjs `listSpecB`). */
  const LIST = { bracket: 1, rank: 2, src: 4, stops: 11, ePos: 6 } as const;
  /** The list's share of a full panel: 88 cols − the mockup's 57 chart cols (gen.mjs `FULL_B`). */
  const LIST_COLS = 31;
  /** Cells of the info columns (gen.mjs `infoSpecB`). */
  const INFO = { rank: 2, src: 4, stops: 17, ePos: 6, ePts: 6, delta: 6 } as const;
  /** Rows below the chart: full the info header, two info rows and the footer; compact one info line. */
  const BELOW_FULL = 4;
  const BELOW_COMPACT = 1;
  /** Cells of the chart's left and right label room (gen.mjs `chartSvgB` `m`: the P20 label stays inside). */
  const PAD_L = 4;
  const PAD_R = 2;
  /** Compact draws the best-ranked lines only, plus the committed one (gen.mjs `prepRows` n 5; R63). */
  const COMPACT_LINES = 5;

  let highlight = $state<number | null>(null);

  const full = $derived(size.mode === 'full');
  const cell = $derived({ w: size.px.width / Math.max(1, size.cols), h: size.px.height / Math.max(1, size.rows) });
  // The variant's job topic (`strategy.car` live, `plans.preview` in the planning round, SP4.3d2 Task 12); before its
  // first result it has no value: the panel frame shows its computing state. `source: planning` outside the round:
  // notApplicable.
  const prepared = $derived(data.prepared as typeof data.prepared | undefined);
  const variant = $derived(variantOf(options.source, prepared));
  const outsideRound = $derived(variant === 'planning' && prepared?.open !== true);
  const plan = $derived(variant === 'planning' ? (data.preview as typeof data.preview | undefined) : (data.plan as typeof data.plan | undefined));
  const value = $derived<PlanTable | undefined>(plan?.value.known === true ? plan.value.value : undefined);
  const rows = $derived<readonly McRow[]>(value?.rows ?? []);
  const hi = $derived(highlight !== null && highlight < rows.length ? highlight : null);
  const box = $derived({
    width: (full ? Math.max(0, size.cols - LIST_COLS) : size.cols) * cell.w,
    height: Math.max(1, size.rows - (full ? BELOW_FULL : BELOW_COMPACT)) * cell.h,
    pad: { l: PAD_L * cell.w, r: PAD_R * cell.w, t: cell.h / 2, b: cell.h },
  });
  const list = $derived(value === undefined ? [] : listRows(value));
  const info = $derived(value === undefined || hi === null ? undefined : infoRow(value, hi));
  const foot = $derived(value === undefined ? undefined : footer(value));

  /** The slot picker of "save to slot …" is open (window-local, C73). */
  let picking = $state(false);

  const pick = (i: number): void => {
    highlight = hi === i ? null : i;
    picking = false;
  };
  const highlighted = (): McRow | undefined => (hi === null ? undefined : rows[hi]);
  function clear(): void {
    void send({ kind: 'plan.clear', feedId: link.feedId, carId: link.primary });
  }
  function activate(): void {
    const slot = highlighted()?.slot ?? null;
    if (slot !== null) void send({ kind: 'plan.activate', feedId: link.feedId, carId: link.primary, slot });
  }
  function saveTo(slot: Slot): void {
    const row = highlighted();
    picking = false;
    if (row !== undefined) void send({ kind: 'plan.save', feedId: link.feedId, carId: link.primary, slot, policy: row.policy });
  }
  const onKey = (i: number) => (e: KeyboardEvent): void => {
    if (e.key === 'Enter') pick(i);
  };
</script>

{#if outsideRound}
  <div class="line"><TextCell text="" reason="notApplicable" /></div>
{:else if plan === undefined}
  <!-- computing: the panel frame's state -->
{:else if !plan.value.known}
  <div class="line"><TextCell text="" reason={plan.value.reason} /></div>
{:else if value !== undefined}
  {#if full}
    <div class="top">
      <StrategyChart {rows} highlight={hi} {box} currentPosition={value.currentPosition} onpick={pick} />
      <div class="list">
        <div class="line" style:color={role('textDim')}>{' '.repeat(LIST.bracket)} <TextCell text={text.headers.rank} width={LIST.rank} align="right" /> <TextCell
            text={text.headers.src}
            width={LIST.src}
          /> <TextCell text={text.headers.stops} width={LIST.stops} /> <TextCell text={text.headers.ePos} width={LIST.ePos} align="right" /></div>
        {#each list as r, i (i)}
          <div
            class="line row"
            class:on={i === hi}
            class:committed={r.committed}
            data-testid="row-{i}"
            title={r.infeasible ?? undefined}
            role="button"
            tabindex="0"
            onclick={() => pick(i)}
            onkeydown={onKey(i)}
          >{#if r.bracket !== null}<span
                class="bracket"
                data-testid="bracket-{i}"
                data-role={r.bracket.role}
                title={r.bracket.hover}
                ><svg width={cell.w} height={cell.h}
                  ><line x1={cell.w / 2} x2={cell.w / 2} y1={r.bracket.first ? cell.h / 2 : 0} y2={r.bracket.last ? cell.h / 2 : cell.h} style:stroke={role(r.bracket.role)} />{#if r.bracket.first}<line
                      x1={cell.w / 2}
                      x2={cell.w}
                      y1={cell.h / 2}
                      y2={cell.h / 2}
                      style:stroke={role(r.bracket.role)}
                    />{/if}{#if r.bracket.last}<line x1={cell.w / 2} x2={cell.w} y1={cell.h / 2} y2={cell.h / 2} style:stroke={role(r.bracket.role)} />{/if}</svg
                ></span
              >{:else}{' '.repeat(LIST.bracket)}{/if} <TextCell text={r.rank} width={LIST.rank} align="right" /> <TextCell
              text={r.source.text}
              title={r.source.hover}
              role={r.committed || i === hi ? undefined : 'textDim'}
              width={LIST.src}
            /> <TextCell text={r.stops} width={LIST.stops} /> <TextCell text={r.ePos} width={LIST.ePos} align="right" /></div>
        {/each}
      </div>
    </div>
    <div data-testid="info">
      <div class="line" style:color={role('textDim')}> <TextCell text={text.headers.rank} width={INFO.rank} align="right" /> <TextCell
          text={text.headers.src}
          width={INFO.src}
        /> <TextCell text={text.headers.stops} width={INFO.stops} /> <TextCell
          text={text.headers.ePos}
          width={INFO.ePos}
          align="right"
        /> <TextCell text={text.headers.ePts} width={INFO.ePts} align="right" /> <TextCell text={deltaHeader(value)} width={INFO.delta} align="right" /></div>
      {#if info !== undefined}
        <div class="line on"> <TextCell text={info.rank} width={INFO.rank} align="right" /> <TextCell
            text={info.source.text}
            title={info.source.hover}
            width={INFO.src}
          /> <TextCell text={info.stops} width={INFO.stops} /> <TextCell
            text={info.ePos}
            width={INFO.ePos}
            align="right"
          /> <TextCell text={info.ePoints} width={INFO.ePts} align="right" /> <TextCell text={info.delta} width={INFO.delta} align="right" /> {#if variant === 'planning'}<!-- the round's plans are saved on the plan board -->{:else if info.button === 'clear'}<button
              type="button"
              class="pw-button act"
              data-testid="clear"
              title={text.clearHover}
              onclick={clear}>{text.clear}</button
            >{:else if info.button === 'activate'}<button
              type="button"
              class="pw-button act"
              data-testid="activate"
              title={text.activateHover}
              onclick={activate}>{text.activate}</button
            >{:else}<button
              type="button"
              class="pw-button act"
              data-testid="save"
              title={text.saveHover}
              onclick={() => (picking = !picking)}>{text.save}</button
            >{/if}</div>
        {#if picking && info.button === 'save' && variant === 'live'}
          <div class="line" data-testid="picker"> {text.pickArrow}{#each PLAN_SLOTS as s (s)} <button
              type="button"
              class="pw-button act"
              data-testid="pick-{s}"
              title={text.saveHover}
              onclick={() => saveTo(s)}>{s}</button
            >{/each}</div>
        {:else}
          <div class="line"> </div>
        {/if}
      {:else}
        <div class="line"> </div>
        <div class="line"> </div>
      {/if}
    </div>
    {#if foot !== undefined}
      <div class="line" data-testid="footer"> <span style:color={role('textFaint')}>{text.meta.n}</span> <TextCell
          text={foot.n.text}
          role={foot.n.role}
          title={foot.n.hover}
        />  <span style:color={role('textFaint')}>{text.meta.cand}</span> {foot.cand}</div>
    {/if}
  {:else}
    <StrategyChart {rows} highlight={hi} {box} currentPosition={value.currentPosition} limit={COMPACT_LINES} onpick={pick} />
    {#if info !== undefined}
      <div class="line on" data-testid="info"> {info.rank} <TextCell text={info.stops} width={LIST.stops} /> {info.ePos} <span
          style:color={role('text')}>{info.ePoints}</span
        ></div>
    {/if}
  {/if}
{/if}

<style>
  .top {
    display: flex;
  }
  .list {
    white-space: pre;
  }
  .line {
    white-space: pre;
  }
  .row {
    cursor: pointer;
  }
  .on {
    color: var(--pw-ownCar);
    font-weight: var(--pw-weight-bold);
  }
  .row.on {
    background: var(--pw-bgBand);
  }
  .row.committed {
    box-shadow: inset var(--pw-bar-px) 0 0 var(--pw-text);
  }
  .bracket svg {
    display: inline-block;
    vertical-align: top;
  }
  .act {
    color: var(--pw-textDim);
  }
</style>
