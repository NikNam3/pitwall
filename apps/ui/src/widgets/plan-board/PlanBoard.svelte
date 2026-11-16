<script lang="ts">
  // The plan board (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html): our car's plan slots
  // (the active one marked, ΔPOS and ΔTIME against it, E[POS] with the MC's SE, the places strip, an infeasible slot
  // faint), then the DP's best plan per stop count with `→ slot` or `= <slot>`. Every number is `strategy`'s; rows.ts
  // selects and formats them (C65). A selection, the slot picker and the edit draft are window-local (C73); save,
  // activate and remove go through the panel (C74). Whether the actions are offered is the presentation table's (C66).
  import type { Slot } from '@pitwall/domain';
  import { PLAN_SLOTS } from '@pitwall/domain';
  import { getUiActions } from '../../kit/actions.ts';
  import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
  import DistStrip from '../../kit/dist/DistStrip.svelte';
  import { placesHeader } from '../../kit/dist/places.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import * as draftOps from './draft.ts';
  import { changedFields, COMPOUNDS, draftOf, policyOfDraft, type Changed, type Draft } from './draft.ts';
  import { dimRole, headerRole, lineRole, rejectedRole } from './emphasis.ts';
  import { actionsShown } from './presentation.ts';
  import { boardRows, freeSlot, type BoardTable, type DpLine, type SlotLine, type StopCount } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, options, size, link }: WidgetProps<typeof widget> = $props();
  const { send } = getUiActions();

  /** The lead cell and the cell between two columns. */
  const LEAD = ' ';
  const GAP = ' ';
  /** Column widths (gen.mjs `boardSpec`). */
  const SLOT = 3;
  const STOPS = { full: 23, compact: 15 } as const;
  const EPOS = 9;
  const DPOS = 6;
  const DTIME = 6;
  const ACT = 8;
  /** The lap field's width in cells. */
  const LAP = 2;

  let selected = $state<Slot | null>(null);
  let pickFor = $state<StopCount | null>(null);
  let draft = $state<Draft | null>(null);
  let rejected = $state<{ message: string; changed: Changed } | null>(null);

  const full = $derived(size.mode === 'full');
  // The job's topic before its first result has no value: the panel frame shows its computing state.
  const plan = $derived(data.plan as typeof data.plan | undefined);
  const planning = $derived(options.source === 'planning');
  const value = $derived<BoardTable | undefined>(!planning && plan?.value.known === true ? plan.value.value : undefined);
  const view = $derived(value === undefined ? undefined : boardRows(value, full ? 'full' : 'compact'));
  const places = $derived(view === undefined ? 0 : (view.slots[0]?.pmf.length ?? view.dp[0]?.pmf.length ?? 0));
  const stopsWidth = $derived(full ? STOPS.full : STOPS.compact);
  const width = $derived(
    LEAD.length + SLOT + GAP.length + stopsWidth + GAP.length + EPOS + GAP.length + DPOS + (full ? 3 * GAP.length + DTIME + places + ACT : 0),
  );
  const acting = $derived(full && actionsShown(data.phase));
  const sel = $derived(acting && selected !== null ? view?.slots.find((l) => l.slot === selected) : undefined);
  const free = $derived(value === undefined ? undefined : freeSlot(value));

  function select(line: SlotLine): void {
    if (!acting || line.slot === null) return;
    selected = selected === line.slot ? null : line.slot;
    pickFor = null;
  }
  const onKey = (line: SlotLine) => (e: KeyboardEvent): void => {
    if (e.key === 'Enter') select(line);
  };
  function openPicker(n: StopCount): void {
    pickFor = pickFor === n ? null : n;
    selected = null;
  }
  function pick(slot: Slot): void {
    const line = view?.dp.find((l) => l.stopCount === pickFor);
    pickFor = null;
    if (line === undefined) return;
    void send({ kind: 'plan.save', feedId: link.feedId, carId: link.primary, slot, policy: line.policy });
  }
  function activate(slot: Slot): void {
    void send({ kind: 'plan.activate', feedId: link.feedId, carId: link.primary, slot });
  }
  function remove(slot: Slot): void {
    void send({ kind: 'plan.remove', feedId: link.feedId, carId: link.primary, slot });
  }
  function edit(line: SlotLine): void {
    if (line.slot === null) return;
    draft = draftOf(line.slot, line.policy);
    rejected = null;
  }
  /** One edit of the draft; the next edit after a rejection clears it. */
  function change(next: Draft): void {
    draft = next;
    rejected = null;
  }
  async function save(slot: Slot): Promise<void> {
    const d = draft;
    if (d === null) return;
    const outcome = await send({ kind: 'plan.save', feedId: link.feedId, carId: link.primary, slot, policy: policyOfDraft(d) });
    if (draft !== d) return;
    if (outcome.ok) {
      draft = null;
      rejected = null;
    } else rejected = { message: outcome.message ?? text.rejectedNoReason, changed: changedFields(d) };
  }
  function cancel(): void {
    draft = null;
    rejected = null;
  }
  const bad = (i: number, field: 'lap' | 'compound'): boolean => rejected?.changed[i]?.[field] === true;
</script>

{#snippet cells(l: SlotLine | DpLine, active: boolean, faint: boolean)}<TextCell
    text={l.stops}
    width={stopsWidth}
    title={'hover' in l ? l.hover : undefined}
  />{GAP}<TextCell text={l.ePos} width={EPOS} align="right" />{GAP}<TextCell
    text={l.dPos}
    width={DPOS}
    align="right"
    role={l.dPosRole}
  />{#if full && view !== undefined}{GAP}<TextCell text={l.dTime} width={DTIME} align="right" />{GAP}<DistStrip
      form="places"
      pmf={l.pmf}
      scale={view.scale}
      ourPlace={view.ourPlace}
      lit={active && !faint}
    />{/if}{/snippet}

{#snippet dpAct(l: DpLine)}{#if l.same !== null}<span data-testid="same-{l.stopCount}" style:color={role(dimRole)} title={text.sameAsHover}
      >{text.sameAs(l.same)}</span
    >{:else if acting}<button
      type="button"
      class="pw-button act"
      data-testid="to-slot-{l.stopCount}"
      title={text.hover.save}
      onclick={() => openPicker(l.stopCount)}>{text.toSlot}</button
    >{/if}{/snippet}

{#snippet editor(d: Draft)}
  <div data-testid="editor">
    <div class="line">{LEAD}<TextCell text={d.slot} width={SLOT} />{GAP}{#each d.stops as s, i (i)}{GAP}<span style:color={role(dimRole)}
          >{text.lapPrefix}</span
        ><input
          type="text"
          inputmode="numeric"
          spellcheck="false"
          class="pw-input fld"
          data-testid="edit-lap-{i}"
          data-role={bad(i, 'lap') ? rejectedRole : undefined}
          title={bad(i, 'lap') ? rejected?.message : undefined}
          style:width="{LAP}ch"
          style:color={bad(i, 'lap') ? role(rejectedRole) : undefined}
          bind:value={() => s.lap, (v: string) => change(draftOps.setLap(d, i, v))}
        /> {text.arrow} <select
          class="pw-input fld"
          data-testid="edit-compound-{i}"
          data-role={bad(i, 'compound') ? rejectedRole : undefined}
          title={bad(i, 'compound') ? rejected?.message : undefined}
          style:color={bad(i, 'compound') ? role(rejectedRole) : undefined}
          bind:value={() => s.compound, (v: (typeof COMPOUNDS)[number]) => change(draftOps.setCompound(d, i, v))}
        >
          {#each COMPOUNDS as c (c)}<option value={c}>{COMPOUND_MARK[c].letter}</option>{/each}
        </select> <button type="button" class="pw-button act" data-testid="edit-drop-{i}" onclick={() => change(draftOps.dropStop(d, i))}
          >{text.dropStop}</button
        >{GAP}{GAP}{/each}{GAP}<button type="button" class="pw-button act" data-testid="edit-add" onclick={() => change(draftOps.addStop(d))}
        >{text.addStop}</button
      ></div>
    <div class="line">{LEAD}{' '.repeat(SLOT)}{GAP}<button
        type="button"
        class="pw-button act"
        data-testid="edit-save"
        title={text.hover.save}
        onclick={() => void save(d.slot)}>{text.saveTo(d.slot)}</button
      >{#if free !== undefined}{GAP}{GAP}<button
          type="button"
          class="pw-button act"
          data-testid="edit-save-as"
          title={text.hover.save}
          onclick={() => void save(free)}>{text.saveAs(free)}</button
        >{/if}{GAP}{GAP}<button type="button" class="pw-button act" data-testid="edit-cancel" onclick={cancel}>{text.cancel}</button></div>
  </div>
{/snippet}

{#if planning || (plan !== undefined && !plan.value.known)}
  <div class="line"><TextCell text="" reason={plan !== undefined && !plan.value.known ? plan.value.reason : 'notApplicable'} /></div>
{:else if view !== undefined}
  <div class="block">
    <div class="line" style:color={role(headerRole)}>{LEAD}{' '.repeat(SLOT)}{GAP}<TextCell text={text.headers.stops} width={stopsWidth} />{GAP}<TextCell
        text={text.headers.ePos}
        width={EPOS}
        align="right"
      />{GAP}<TextCell text={text.headers.dPos} width={DPOS} align="right" />{#if full}{GAP}<TextCell
          text={text.headers.dTime}
          width={DTIME}
          align="right"
        />{GAP}<TextCell text={placesHeader(places)} />{/if}</div>
    {#each view.slots as l (l.key)}
      <div
        class="line row"
        class:active={l.active}
        class:on={l.slot !== null && l.slot === sel?.slot}
        data-testid="row-{l.key}"
        style:color={roleOrUndefined(lineRole(l.active, l.faint))}
        role="button"
        tabindex="0"
        onclick={() => select(l)}
        onkeydown={onKey(l)}
      >{LEAD}<TextCell text={l.label} width={SLOT} />{GAP}{@render cells(l, l.active, l.faint)}</div>
    {/each}
    <div class="line" style:color={role(headerRole)}>{text.dpRule(width)}</div>
    {#each view.dp as l (l.stopCount)}
      <div class="line" data-testid="dp-{l.stopCount}">{LEAD}{' '.repeat(SLOT)}{GAP}{@render cells(l, false, false)}{#if full}{GAP}{@render dpAct(l)}{/if}</div>
    {/each}
    {#if full}
      {#if draft !== null && acting}
        {@render editor(draft)}
      {:else}
        <div class="line"> </div>
        {#if pickFor !== null && acting}
          <div class="line" data-testid="picker">{LEAD}{' '.repeat(SLOT)}{GAP}{text.arrow}{#each PLAN_SLOTS as s (s)}{GAP}<button
                type="button"
                class="pw-button act"
                data-testid="pick-{s}"
                title={text.hover.save}
                onclick={() => pick(s)}>{s}</button
              >{/each}</div>
        {:else if sel !== undefined && sel.slot !== null}
          {@const slot = sel.slot}
          <div class="line" data-testid="actions">{LEAD}<span style:color={role(dimRole)}>{slot}</span>{#if !sel.active}{GAP}{GAP}<button
                type="button"
                class="pw-button act"
                data-testid="activate"
                title={text.hover.activate}
                onclick={() => activate(slot)}>{text.activate}</button
              >{/if}{GAP}{GAP}<button type="button" class="pw-button act" data-testid="edit" onclick={() => edit(sel)}>{text.edit}</button
            >{#if !sel.active}{GAP}{GAP}<button
                type="button"
                class="pw-button act"
                data-testid="remove"
                title={text.hover.remove}
                onclick={() => remove(slot)}>{text.remove}</button
              >{/if}</div>
        {/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .row {
    cursor: pointer;
  }
  .row.active {
    font-weight: var(--pw-weight-bold);
    box-shadow: inset var(--pw-bar-px) 0 0 var(--pw-text);
  }
  .row.on {
    background: var(--pw-bgBand);
  }
  .act {
    color: var(--pw-textDim);
  }
  .line :global(button),
  .fld {
    vertical-align: top;
  }
  /* One character cell tall, as the drivers panel's fields. */
  .fld {
    height: calc(var(--pw-line) * 1em);
    min-height: 0;
    text-align: right;
  }
  select.fld {
    text-align: left;
  }
</style>
