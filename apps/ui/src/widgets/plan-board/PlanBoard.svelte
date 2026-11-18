<script lang="ts">
  // The plan board (SP4.3d spec §6.2, V17; mockup docs/design/2026-11-16-sp4.3d/plan-board.html): our car's plan slots
  // (the active one marked, ΔPOS and ΔTIME against it, E[POS] with the MC's SE, the places strip, an infeasible slot
  // faint), then the DP's best plan per stop count with `→ slot` or `= <slot>`. Every number is `strategy`'s; rows.ts
  // selects and formats them (C65). A selection, the slot picker and the edit draft are window-local (C73); save,
  // activate and remove go through the panel (C74). Whether the actions are offered is the presentation table's (C66).
  // SP4.3d2 Task 12: the variant (presentation.ts `variantOf`): live draws `strategy.car`, planning the planning job's
  // `plans.preview` with the race inputs line (GRID, LAPS, RAIN, N), the START column, the prefilled slots with
  // `accept` and an empty game slot's entry; every planning control, and the race's prefill accept, invokes a shell
  // command by id through the panel (C72, C74). The cell budget is layout.ts'. SP4.3e Task 8: a rejected outcome of a
  // command or action that marks no field shows the bridge's message on the board's last line (C73).
  import type { ActionOutcome } from '@pitwall/contracts';
  import type { NoiseCompound, Slot } from '@pitwall/domain';
  import { PLAN_SLOTS } from '@pitwall/domain';
  import { getUiActions } from '../../kit/actions.ts';
  import { getWidgetCommands } from '../../kit/commands.ts';
  import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
  import DistStrip from '../../kit/dist/DistStrip.svelte';
  import { placesHeader } from '../../kit/dist/places.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { formatCount, formatPercent, formatPosition, formatWhole } from '../../kit/values/format.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import * as draftOps from './draft.ts';
  import { changedFields, COMPOUNDS, draftOf, entryOf, NEW_START, policyOfDraft, type Changed, type Draft } from './draft.ts';
  import { dimRole, headerRole, lineRole, rejectedRole } from './emphasis.ts';
  import { blankAfterInputs, columnsOf, GAME_SLOTS, GAP, LEAD, widthOf } from './layout.ts';
  import { actionsShown, variantOf } from './presentation.ts';
  import { boardRows, freeSlot, type BoardTable, type DpLine, type SlotLine, type StopCount } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, options, size, link }: WidgetProps<typeof widget> = $props();
  const { send } = getUiActions();
  const commands = getWidgetCommands();

  /** The lap field's width in cells; the race laps field's. */
  const LAP = 2;
  const RACE_LAPS = 3;

  type Rejection = { message: string; changed: Changed };

  let selected = $state<Slot | null>(null);
  let pickFor = $state<StopCount | null>(null);
  let draft = $state<Draft | null>(null);
  let rejected = $state<Rejection | null>(null);
  /** The planning round's window-local drafts (C73): the race laps as typed, the entries of empty game slots. */
  let lapsDraft = $state<string | null>(null);
  let lapsRejected = $state<string | null>(null);
  let entries = $state<Partial<Record<Slot, Draft>>>({});
  let entryRejected = $state<Partial<Record<Slot, Rejection>>>({});
  /** The bridge's message of the last rejected command or action that marks no field (C73). */
  let actionRejected = $state<string | null>(null);

  const full = $derived(size.mode === 'full');
  const mode = $derived(full ? 'full' : 'compact');
  const prepared = $derived(data.prepared as typeof data.prepared | undefined);
  const variant = $derived(variantOf(options.source, prepared));
  const planning = $derived(variant === 'planning');
  const round = $derived(planning && prepared?.open === true ? prepared : undefined);
  // The variant's job topic; before its first result it has no value: the panel frame shows its computing state.
  const job = $derived(planning ? (data.preview as typeof data.preview | undefined) : (data.plan as typeof data.plan | undefined));
  const reason = $derived(planning && round === undefined ? 'notApplicable' : job !== undefined && !job.value.known ? job.value.reason : undefined);
  const value = $derived<BoardTable | undefined>(reason === undefined && job?.value.known === true ? job.value.value : undefined);
  const view = $derived(value === undefined ? undefined : boardRows(value, mode));
  const places = $derived(view === undefined ? 0 : (view.slots.find((l) => l.pmf.length > 0)?.pmf.length ?? view.dp[0]?.pmf.length ?? 0));
  const cols = $derived(columnsOf(variant, mode));
  const width = $derived(widthOf(cols, mode, places));
  const acting = $derived(full && (planning || actionsShown(data.phase)));
  const sel = $derived(acting && selected !== null ? view?.slots.find((l) => l.slot === selected && !l.prefill) : undefined);
  const free = $derived(value === undefined ? undefined : freeSlot(value));
  /** Our car's prepared slots (the bridge's, `plans.prepared`). */
  const preparedSlots = $derived(round?.cars[link.primary]?.slots ?? {});

  /** Per slot its line, or in the planning round (full) an empty game slot's entry, in slot order. */
  type Item = { kind: 'line'; line: SlotLine } | { kind: 'entry'; slot: Slot };
  const items = $derived.by((): Item[] => {
    if (view === undefined) return [];
    const lines: Item[] = view.slots.map((line) => ({ kind: 'line', line }));
    if (!planning || !full) return lines;
    const empty = GAME_SLOTS.filter((s) => !view.slots.some((l) => l.slot === s) && preparedSlots[s] === undefined);
    const order = (i: Item): number => {
      const slot = i.kind === 'entry' ? i.slot : i.line.slot;
      return slot === null ? -1 : PLAN_SLOTS.indexOf(slot);
    };
    return [...lines, ...empty.map((slot): Item => ({ kind: 'entry', slot }))].sort((a, b) => order(a) - order(b));
  });
  const blank = $derived(full && blankAfterInputs(items.length, size.rows));

  const planningInputs = $derived(value?.planning ?? null);

  function select(line: SlotLine): void {
    if (!acting || line.slot === null || line.prefill) return;
    selected = selected === line.slot ? null : line.slot;
    pickFor = null;
    actionRejected = null;
  }
  const onKey = (line: SlotLine) => (e: KeyboardEvent): void => {
    if (e.key === 'Enter') select(line);
  };
  function openPicker(n: StopCount): void {
    pickFor = pickFor === n ? null : n;
    selected = null;
    actionRejected = null;
  }
  /**
   * Waits for a command's or action's outcome: a rejection shows the bridge's message on the board's last line until
   * the next control (C73: never a silent nothing).
   */
  async function outcomeOf(pending: Promise<ActionOutcome>): Promise<void> {
    actionRejected = null;
    const outcome = await pending;
    actionRejected = outcome.ok ? null : (outcome.message ?? text.rejectedNoReason);
  }
  function pick(slot: Slot): void {
    const line = view?.dp.find((l) => l.stopCount === pickFor);
    pickFor = null;
    if (line === undefined) return;
    if (planning) void outcomeOf(commands.invoke('plans.prepare.save', { feedId: link.feedId, carId: link.primary, slot, policy: line.policy }));
    else void outcomeOf(send({ kind: 'plan.save', feedId: link.feedId, carId: link.primary, slot, policy: line.policy }));
  }
  function activate(slot: Slot): void {
    if (planning) void outcomeOf(commands.invoke('plans.prepare.activate', { feedId: link.feedId, carId: link.primary, slot }));
    else void outcomeOf(send({ kind: 'plan.activate', feedId: link.feedId, carId: link.primary, slot }));
  }
  function remove(slot: Slot): void {
    if (planning) void outcomeOf(commands.invoke('plans.prepare.remove', { feedId: link.feedId, carId: link.primary, slot }));
    else void outcomeOf(send({ kind: 'plan.remove', feedId: link.feedId, carId: link.primary, slot }));
  }
  /** `accept` on a prefilled line: the prefill becomes the slot's plan (the round's or the race's command). */
  function accept(line: SlotLine): void {
    if (line.slot === null) return;
    const args = { feedId: link.feedId, carId: link.primary, slot: line.slot, policy: line.policy };
    if (planning) void outcomeOf(commands.invoke('plans.prepare.accept', args));
    else void outcomeOf(commands.invoke('plan.accept', args));
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

  // ---- the planning round's controls (C72, C73)
  const entry = (slot: Slot): Draft => entries[slot] ?? entryOf(slot);
  function changeEntry(next: Draft): void {
    entries = { ...entries, [next.slot]: next };
    entryRejected = { ...entryRejected, [next.slot]: undefined };
  }
  async function saveEntry(slot: Slot): Promise<void> {
    const d = entry(slot);
    actionRejected = null;
    const outcome = await commands.invoke('plans.prepare.save', { feedId: link.feedId, carId: link.primary, slot, policy: policyOfDraft(d) });
    if (entries[slot] !== undefined && entries[slot] !== d) return;
    if (outcome.ok) {
      entries = { ...entries, [slot]: undefined };
      entryRejected = { ...entryRejected, [slot]: undefined };
      return;
    }
    const message = outcome.message ?? text.rejectedNoReason;
    const changed = changedFields(d);
    entryRejected = { ...entryRejected, [slot]: { message, changed } };
    // An unchanged entry has no field to mark: the message goes to the board's last line.
    if (!changed.some((c) => c.lap || c.compound)) actionRejected = message;
  }
  const badEntry = (slot: Slot, i: number, field: 'lap' | 'compound'): boolean => entryRejected[slot]?.changed[i]?.[field] === true;

  function typeLaps(v: string): void {
    lapsDraft = v;
    lapsRejected = null;
  }
  /** Commits the race laps field: one command with its number and the round's sets; the bridge validates it (C73). */
  async function commitLaps(): Promise<void> {
    const typed = lapsDraft;
    if (typed === null) return;
    if (typed.trim() === '' || round === undefined) {
      lapsDraft = null;
      return;
    }
    const outcome = await commands.invoke('plans.race.set', { feedId: link.feedId, race: { laps: Number(typed.trim()), sets: round.race.sets } });
    if (lapsDraft !== typed) return;
    if (outcome.ok) {
      lapsDraft = null;
      lapsRejected = null;
    } else lapsRejected = outcome.message ?? text.rejectedNoReason;
  }
  /** The round's race laps: the bridge's suggestion until entered; `null` while neither is known. */
  const entered = $derived(round?.race.laps ?? null);
</script>

{#snippet cells(l: SlotLine | DpLine, active: boolean, faint: boolean)}{#if cols.start > 0}<span data-testid={'key' in l ? `start-${l.key}` : undefined}
      ><TextCell text={l.start} width={cols.start} /></span
    >{GAP}{/if}<TextCell
    text={l.stops}
    width={cols.stops}
    role={'prefill' in l && l.prefill ? dimRole : undefined}
    title={'hover' in l ? l.hover : undefined}
  />{GAP}<TextCell text={l.ePos} width={cols.ePos} align="right" />{GAP}<TextCell
    text={l.dPos}
    width={cols.dPos}
    align="right"
    role={l.dPosRole}
  />{#if full && view !== undefined}{GAP}<TextCell text={l.dTime} width={cols.dTime} align="right" />{GAP}{#if l.pmf.length > 0}<DistStrip
        form="places"
        pmf={l.pmf}
        scale={view.scale}
        ourPlace={view.ourPlace}
        lit={active && !faint}
      />{:else}{' '.repeat(places)}{/if}{/if}{/snippet}

{#snippet dpAct(l: DpLine)}{#if l.same !== null}<span data-testid="same-{l.stopCount}" style:color={role(dimRole)} title={text.sameAsHover}
      >{text.sameAs(l.same)}</span
    >{:else if acting}<button
      type="button"
      class="pw-button act"
      data-testid="to-slot-{l.stopCount}"
      title={planning ? text.commandHover.save : text.hover.save}
      onclick={() => openPicker(l.stopCount)}>{text.toSlot}</button
    >{/if}{/snippet}

{#snippet editor(d: Draft)}
  <div data-testid="editor">
    <div class="line">{LEAD}<TextCell text={d.slot} width={cols.slot} />{GAP}{#each d.stops as s, i (i)}{GAP}<span style:color={role(dimRole)}
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
    <div class="line">{LEAD}{' '.repeat(cols.slot)}{GAP}<button
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

{#snippet entryLine(slot: Slot)}
  {@const d = entry(slot)}
  {@const no = entryRejected[slot]}
  <div class="line" data-testid="entry-{slot}">{LEAD}<TextCell text={slot} width={cols.slot} />{GAP}<select
      class="pw-input fld"
      data-testid="entry-{slot}-start"
      title={text.headers.start}
      bind:value={() => d.start ?? NEW_START, (v: NoiseCompound) => changeEntry(draftOps.setStart(d, v))}
    >
      {#each COMPOUNDS as c (c)}<option value={c}>{COMPOUND_MARK[c].letter}</option>{/each}
    </select>{GAP}{#each d.stops as s, i (i)}{GAP}<span style:color={role(dimRole)}>{text.lapPrefix}</span><input
        type="text"
        inputmode="numeric"
        spellcheck="false"
        class="pw-input fld"
        data-testid="entry-{slot}-lap-{i}"
        data-role={badEntry(slot, i, 'lap') ? rejectedRole : undefined}
        title={badEntry(slot, i, 'lap') ? no?.message : undefined}
        style:width="{LAP}ch"
        style:color={badEntry(slot, i, 'lap') ? role(rejectedRole) : undefined}
        bind:value={() => s.lap, (v: string) => changeEntry(draftOps.setLap(d, i, v))}
      /> {text.arrow} <select
        class="pw-input fld"
        data-testid="entry-{slot}-compound-{i}"
        data-role={badEntry(slot, i, 'compound') ? rejectedRole : undefined}
        title={badEntry(slot, i, 'compound') ? no?.message : undefined}
        style:color={badEntry(slot, i, 'compound') ? role(rejectedRole) : undefined}
        bind:value={() => s.compound, (v: NoiseCompound) => changeEntry(draftOps.setCompound(d, i, v))}
      >
        {#each COMPOUNDS as c (c)}<option value={c}>{COMPOUND_MARK[c].letter}</option>{/each}
      </select> <button type="button" class="pw-button act" data-testid="entry-{slot}-drop-{i}" onclick={() => changeEntry(draftOps.dropStop(d, i))}
        >{text.dropStop}</button
      >{/each}{GAP}<button type="button" class="pw-button act" data-testid="entry-{slot}-add" onclick={() => changeEntry(draftOps.addStop(d))}
      >{text.addStop}</button
    >{GAP}{GAP}<button
      type="button"
      class="pw-button act"
      data-testid="entry-{slot}-save"
      title={text.commandHover.save}
      onclick={() => void saveEntry(slot)}>{text.saveTo(slot)}</button
    ></div>
{/snippet}

<!-- The bridge's message of a rejected command or action in the warning role, the whole message on hover; a blank line otherwise. -->
{#snippet rejectionLine()}
  <div class="line">{LEAD}{#if actionRejected !== null}<span data-testid="rejection" data-role={rejectedRole} title={actionRejected}
        ><TextCell text={text.rejected(actionRejected)} width={width - LEAD.length} role={rejectedRole} /></span
      >{/if}</div>
{/snippet}

{#snippet inputsLine()}
  <div class="line" data-testid="inputs">{LEAD}<span style:color={role(headerRole)}>{text.inputs.grid}</span> {#if planningInputs !== null}<TextCell
        text={planningInputs.gridPlace.known ? formatPosition(planningInputs.gridPlace.value) : ''}
        reason={planningInputs.gridPlace.known ? undefined : planningInputs.gridPlace.reason}
      />{/if}{GAP}{GAP}{GAP}<span style:color={role(headerRole)}>{text.inputs.laps}</span> <input
      type="text"
      inputmode="numeric"
      spellcheck="false"
      class="pw-input fld"
      data-testid="laps"
      data-role={lapsRejected !== null ? rejectedRole : undefined}
      title={lapsRejected ?? text.commandHover.laps}
      style:width="{RACE_LAPS}ch"
      style:color={lapsRejected !== null ? role(rejectedRole) : undefined}
      value={lapsDraft ?? (entered === null ? '' : formatWhole(entered))}
      oninput={(e) => typeLaps(e.currentTarget.value)}
      onchange={() => void commitLaps()}
    />{GAP}{GAP}{GAP}<span style:color={role(headerRole)}>{text.inputs.rain}</span> {#if planningInputs !== null}<TextCell
        text={planningInputs.rainPct.known ? formatPercent(planningInputs.rainPct.value) : ''}
        reason={planningInputs.rainPct.known ? undefined : planningInputs.rainPct.reason}
      />{/if}{GAP}{GAP}{GAP}<span style:color={role(headerRole)}>{text.inputs.n}</span> {#if value !== undefined}{formatCount(
        value.scenarios,
      )}{/if}{#if round?.running === true}{GAP}{GAP}{GAP}<span data-testid="computing" style:color={role(dimRole)} title={text.computingHover}
        >{text.computing}</span
      >{/if}</div>
{/snippet}

{#if reason !== undefined}
  <div class="line"><TextCell text="" {reason} /></div>
{:else}
  {#if round !== undefined && full}
    {@render inputsLine()}
    {#if blank && view !== undefined}<div class="line"> </div>{/if}
  {/if}
  {#if view !== undefined}
    <div class="block">
      <div class="line" style:color={role(headerRole)}>{LEAD}{' '.repeat(cols.slot)}{GAP}{#if cols.start > 0}<TextCell
            text={text.headers.start}
            width={cols.start}
          />{GAP}{/if}<TextCell text={text.headers.stops} width={cols.stops} />{GAP}<TextCell
          text={text.headers.ePos}
          width={cols.ePos}
          align="right"
        />{GAP}<TextCell text={text.headers.dPos} width={cols.dPos} align="right" />{#if full}{GAP}<TextCell
            text={text.headers.dTime}
            width={cols.dTime}
            align="right"
          />{GAP}<TextCell text={placesHeader(places)} />{/if}</div>
      {#each items as item (item.kind === 'entry' ? `entry-${item.slot}` : item.line.key)}
        {#if item.kind === 'entry'}
          {@render entryLine(item.slot)}
        {:else}
          {@const l = item.line}
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
          >{LEAD}<TextCell text={l.label} width={cols.slot} />{GAP}{@render cells(l, l.active, l.faint)}{#if l.prefill && acting}{GAP}<button
                type="button"
                class="pw-button act"
                data-testid="accept-{l.key}"
                title={planning ? text.commandHover.accept : text.commandHover.raceAccept}
                onclick={(e) => {
                  e.stopPropagation();
                  accept(l);
                }}>{text.accept}</button
              >{/if}</div>
        {/if}
      {/each}
      <div class="line" style:color={role(headerRole)}>{text.dpRule(width)}</div>
      {#each view.dp as l (l.stopCount)}
        <div class="line" data-testid="dp-{l.stopCount}">{LEAD}{' '.repeat(cols.slot)}{GAP}{@render cells(l, false, false)}{#if full}{GAP}{@render dpAct(l)}{/if}</div>
      {/each}
      {#if full}
        {#if draft !== null && acting && !planning}
          {@render editor(draft)}
        {:else}
          <!-- the race: a blank, then the picker or the actions; the planning round: the last line holds them (layout.ts) -->
          {#if !planning}{@render rejectionLine()}{/if}
          {#if pickFor !== null && acting}
            <div class="line" data-testid="picker">{LEAD}{' '.repeat(cols.slot)}{GAP}{text.arrow}{#each PLAN_SLOTS as s (s)}{GAP}<button
                  type="button"
                  class="pw-button act"
                  data-testid="pick-{s}"
                  title={planning ? text.commandHover.save : text.hover.save}
                  onclick={() => pick(s)}>{s}</button
                >{/each}</div>
          {:else if sel !== undefined && sel.slot !== null}
            {@const slot = sel.slot}
            <div class="line" data-testid="actions">{LEAD}<span style:color={role(dimRole)}>{slot}</span>{#if !sel.active}{GAP}{GAP}<button
                  type="button"
                  class="pw-button act"
                  data-testid="activate"
                  title={planning ? text.commandHover.activate : text.hover.activate}
                  onclick={() => activate(slot)}>{text.activate}</button
                >{/if}{#if !planning}{GAP}{GAP}<button type="button" class="pw-button act" data-testid="edit" onclick={() => edit(sel)}>{text.edit}</button
                >{/if}{#if !sel.active}{GAP}{GAP}<button
                  type="button"
                  class="pw-button act"
                  data-testid="remove"
                  title={planning ? text.commandHover.remove : text.hover.remove}
                  onclick={() => remove(slot)}>{text.remove}</button
                >{/if}</div>
          {:else if planning}
            {@render rejectionLine()}
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
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
