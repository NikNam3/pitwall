<script lang="ts">
  // The calibration panel (SP4.1a spec 6; mockup docs/design/2026-11-06-sp4.1a/calibration-panel.html, README Q1–Q8 A):
  // the sets of a track, their sources (a source opens to its laps), the suggestions and the set's values, each with an
  // override field. Every control sends one `calibration.*` uiAction and takes effect when the bridge publishes it (C73);
  // the track, the set, the opened source and a draft are window-local. A rejection shows the bridge's reason.
  import type { UiAction } from '@pitwall/contracts';
  import type { CalibrationSource, SourceFit } from '@pitwall/domain';
  import { getUiActions } from '../../kit/actions.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { formatDay, formatTrack } from '../../kit/values/format.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role } from '../../theme/index.ts';
  import {
    COMPOUNDS, LIMIT_SPECS, PIT_SPECS, compactDegSpec, compoundLabel, compoundSpecs, lapColumns, overrideAction, overrideText,
    runningSetId, sessionState, setsOf, shownSet, sourceKey, sourceRow, trackOf, trackOptions, valueCell, type ValueSpec,
  } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const { send } = getUiActions();

  /** Column widths of the sources and suggestions table (mockup). */
  const W = { session: 7, date: 6, car: 3, cmp: 3, stint: 6, laps: 5, deg: 7, drift: 6, act: 6 } as const;
  /** The compact mode's source columns. */
  const C = { session: 4, date: 6, car: 3, cmp: 2, deg: 7, drift: 6 } as const;
  /** The opened source's laps: three columns of 24 cells; a lap's toggle, number and time take 17 of them. */
  const LAP_COLUMNS = 3;
  const LAP_REST = 24 - 17;
  /** Lines of the compact mode besides the sources: the set line, the deg line, the pit line. */
  const COMPACT_FIXED_LINES = 3;
  /** Character cells of space: Svelte trims whitespace at a tag's edges, so the lines spell theirs out. */
  const SP = ' ';
  const SP2 = '  ';
  const SP3 = '   ';
  /** Where a never-pace lap's toggle would be. */
  const NO_TOGGLE = '    ';

  const full = $derived(size.mode === 'full');

  // Window-local choices (C73).
  let pickedTrack = $state<number | undefined>(undefined);
  let pickedSet = $state<string | undefined>(undefined);
  let opened = $state<string | undefined>(undefined);
  let naming = $state<'new' | 'copy' | 'rename' | undefined>(undefined);
  let rejection = $state<string | undefined>(undefined);
  let nameField = $state<HTMLInputElement>();

  const trackId = $derived(trackOf(data.active, data.candidates, pickedTrack));
  const tracks = $derived(trackOptions(trackId, data.sets, data.candidates));
  const trackSets = $derived(setsOf(data.sets, trackId));
  const running = $derived(runningSetId(data.active, trackId));
  const set = $derived(shownSet(trackSets, pickedSet, running));
  const setValues = $derived(set === undefined ? undefined : data.values.bySet[set.id]);
  const fits = $derived(setValues?.fits ?? []);
  const overrides = $derived(set?.overrides ?? {});
  const suggestions = $derived(trackId === null ? [] : (data.candidates.byTrack[trackId] ?? []));
  const sessionWord = $derived(sessionState(data.active, set?.id, running, !full));
  const isActive = $derived(sessionWord === text.activeInRace || sessionWord === text.activeShort);
  const shownFits = $derived(full ? fits : fits.slice(0, Math.max(0, size.rows - COMPACT_FIXED_LINES)));

  $effect(() => nameField?.focus());

  /** Sends an action; a rejection shows the bridge's reason. Resolves whether the bridge accepted it. */
  async function act(action: UiAction): Promise<boolean> {
    rejection = undefined;
    const outcome = await send(action);
    if (outcome.ok) return true;
    rejection = text.rejected(outcome.message ?? text.rejectedNoReason);
    return false;
  }

  function pickTrack(value: string): void {
    pickedTrack = Number(value);
    pickedSet = undefined;
    opened = undefined;
    naming = undefined;
  }
  function pickSet(value: string): void {
    pickedSet = value;
    opened = undefined;
    naming = undefined;
  }

  async function commitName(typed: string): Promise<void> {
    const name = typed.trim();
    if (naming === undefined || name === '' || trackId === null) return;
    let action: UiAction | undefined;
    if (naming === 'new') action = { kind: 'calibration.set.create', trackId, name };
    else if (set !== undefined) action = { kind: naming === 'copy' ? 'calibration.set.copy' : 'calibration.set.rename', trackId, setId: set.id, name };
    if (action !== undefined && (await act(action))) naming = undefined;
  }
  function nameKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') naming = undefined;
  }

  /** Every action on the shown set carries its track and id. */
  const onSet = (): { trackId: number; setId: string } | undefined =>
    trackId === null || set === undefined ? undefined : { trackId, setId: set.id };

  function deleteSet(): void {
    const at = onSet();
    if (at !== undefined) void act({ kind: 'calibration.set.delete', ...at });
  }
  function sourceAction(kind: 'calibration.source.add' | 'calibration.source.remove', source: CalibrationSource): void {
    const at = onSet();
    if (at !== undefined) void act({ kind, ...at, source });
  }
  function toggleLap(source: CalibrationSource, lap: number, toggle: 'kept' | 'excluded'): void {
    const at = onSet();
    if (at !== undefined) void act({ kind: toggle === 'kept' ? 'calibration.lap.exclude' : 'calibration.lap.include', ...at, source, lap });
  }
  function commitOverride(spec: ValueSpec, typed: string): void {
    const at = onSet();
    const action = at === undefined ? undefined : overrideAction(spec, typed, { ...at, overrides });
    if (action !== undefined) void act(action);
  }

  const header = (cells: [string, number, 'left' | 'right'][]): string => cells.map(([t, w, a]) => fitCell(t, w, a)).join(SP);
  const sourceHeader = header([
    [text.sourceHeaders.session, W.session, 'left'], [text.sourceHeaders.date, W.date, 'left'], [text.sourceHeaders.car, W.car, 'left'],
    [text.sourceHeaders.cmp, W.cmp, 'left'], [text.sourceHeaders.stint, W.stint, 'left'], [text.sourceHeaders.laps, W.laps, 'right'],
    [text.sourceHeaders.deg, W.deg, 'right'], [text.sourceHeaders.drift, W.drift, 'right'],
  ]);
  const valueHeader = header([
    [text.valueHeaders.cmp, 3, 'left'],
    ...compoundSpecs('soft').map((c): [string, number, 'right'] => [text.valueHeaders[c.column], c.spec.width, 'right']),
  ]);
  const pitHeader = header([[text.pitHeaders.cond, 5, 'left'], [text.pitHeaders.set, 5, 'right'], [text.pitHeaders.ovr, 5, 'left']]);
  const skippedWidth = W.laps + W.deg + W.drift + 2;
  const compactPitWidth = 4;
</script>

{#snippet value(spec: ValueSpec)}
  {@const cell = valueCell(spec, setValues?.entries, overrides)}
  <span data-testid="value-{spec.key}" title={cell.title} style:color={cell.unknown ? role('textFaint') : undefined}>{fitCell(cell.text, spec.width, 'right')}</span>
{/snippet}

{#snippet field(spec: ValueSpec)}
  <input
    type="text"
    inputmode="decimal"
    spellcheck="false"
    class="pw-input fld"
    data-testid="override-{spec.key}"
    aria-label={spec.key}
    style:width="{spec.width}ch"
    value={overrideText(spec, overrides)}
    onchange={(e) => commitOverride(spec, e.currentTarget.value)}
  />
{/snippet}

{#snippet sourceLine(fit: SourceFit, i: number, kind: 'source' | 'candidate')}
  {@const r = sourceRow(fit)}
  {@const open = kind === 'source' && opened === sourceKey(fit.source)}
  <div class="line" data-testid="{kind}-{i}">
    {#if full}{SP}{#if kind === 'source' && r.fitted !== undefined}<button
          type="button"
          class="pw-button dim"
          data-testid="source-open-{i}"
          onclick={() => (opened = open ? undefined : sourceKey(fit.source))}>{open ? text.opener.open : text.opener.closed}</button
        >{:else}<span class="faint">{kind === 'source' ? text.opener.closed : SP}</span>{/if}{SP}<span class:faint={r.skipped !== undefined}
        ><TextCell {...r.session} width={W.session} />{SP}<TextCell {...r.date} width={W.date} />{SP}<TextCell {...r.car} width={W.car} />{SP}<TextCell
          {...r.cmp}
          width={W.cmp}
        />{SP}<TextCell text={r.stint} width={W.stint} /></span
      >{SP}{#if r.skipped !== undefined}<span title={text.skippedHover[r.skipped]} style:color={role('warning')}
          >{fitCell(text.skippedWord[r.skipped], skippedWidth)}</span
        >{:else}<TextCell text={r.laps} width={W.laps} align="right" title={r.lapsHover} />{SP}<TextCell {...r.deg} width={W.deg} align="right" />{SP}<TextCell
          {...r.drift}
          width={W.drift}
          align="right"
          title={kind === 'source' ? text.driftHover : undefined}
        />{/if}{SP}{#if kind === 'source'}<button
          type="button"
          class="pw-button dim"
          data-testid="source-remove-{i}"
          title={text.removeHover}
          onclick={() => sourceAction('calibration.source.remove', fit.source)}>{fitCell(text.remove, W.act, 'right')}</button
        >{:else}<button
          type="button"
          class="pw-button dim"
          data-testid="candidate-add-{i}"
          onclick={() => sourceAction('calibration.source.add', fit.source)}>{fitCell(text.add, W.act, 'right')}</button
        >{/if}
    {:else}{SP}<span class:faint={r.skipped !== undefined}
        ><TextCell {...r.session} width={C.session} />{SP}<TextCell {...r.date} width={C.date} />{SP}<TextCell {...r.car} width={C.car} />{SP}<TextCell
          {...r.cmp}
          width={C.cmp}
        /></span
      >{SP}{#if r.skipped !== undefined}<span title={text.skippedHover[r.skipped]} style:color={role('warning')}>{text.skippedWord[r.skipped]}</span
        >{:else}<TextCell {...r.deg} width={C.deg} align="right" />{SP}<TextCell {...r.drift} width={C.drift} align="right" />{/if}
    {/if}
  </div>
  {#if open && r.fitted !== undefined}
    {#each lapColumns(r.fitted, LAP_COLUMNS) as lapRow, n (n)}
      <div class="line">
        {SP2}{#each lapRow as lap (lap.lapNumber)}{SP}{#if lap.toggle === undefined}<span class="faint" title={text.neverPaceHover}
              >{NO_TOGGLE}{lap.label}{SP}<TextCell {...lap.time} width={8} />{SP}{fitCell(lap.reason, LAP_REST - 1)}</span
            >{:else}<button
              type="button"
              class="pw-button"
              data-testid="lap-{i}-{lap.lapNumber}"
              onclick={() => toggleLap(fit.source, lap.lapNumber, lap.toggle)}>{text.lapToggle[lap.toggle]}</button
            >{SP}<span
              class:faint={lap.toggle === 'excluded'}
              class:dim={lap.downWeighted}
              title={lap.toggle === 'excluded' ? text.lapExcludedHover : lap.downWeighted ? text.lapDownWeightedHover : undefined}
              >{lap.label}{SP}<TextCell {...lap.time} width={8} />{fitCell('', LAP_REST)}</span
            >{/if}{/each}
      </div>
    {/each}
  {/if}
{/snippet}

<div class="block">
  <!-- The set line: the picker, whether the race runs on it, the set actions. -->
  <div class="line">
    {SP}{#if full}<span class="faint">{text.setLabel}</span>{SP}{/if}{#if trackSets.length > 0}<select
        class="pw-input fld"
        data-testid="set-picker"
        aria-label={text.setLabel}
        style:width="{full ? 22 : 20}ch"
        bind:value={() => set?.id ?? '', pickSet}
      >
        {#each trackSets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>{:else}<span class="faint"
        >{trackId === null ? (full ? text.noTrack : text.noTrackShort) : full ? text.noSet : text.noSetShort}</span
      >{/if}{SP2}<span
      data-testid="session-state"
      class:faint={!isActive}
      title={data.active.known ? text.activeHover : undefined}>{sessionWord}</span
    >{#if full && trackId !== null}{SP2}<button type="button" class="pw-button dim" data-testid="set-new" onclick={() => (naming = 'new')}
        >{text.actions.new}</button
      >{#if set !== undefined}{SP}<button type="button" class="pw-button dim" data-testid="set-copy" onclick={() => (naming = 'copy')}
          >{text.actions.copy}</button
        >{SP}<button type="button" class="pw-button dim" data-testid="set-rename" onclick={() => (naming = 'rename')}>{text.actions.rename}</button
        >{SP}<button type="button" class="pw-button dim" data-testid="set-delete" onclick={deleteSet}>{text.actions.delete}</button>{/if}{/if}
  </div>

  {#if full}
    <!-- The track (a picker without a session) and the set's dates, or the name field of new, copy and rename. -->
    <div class="line">
      {SP}{#if naming !== undefined}<span class="faint">{text.nameLabel}</span>{SP}<input
          bind:this={nameField}
          type="text"
          spellcheck="false"
          class="pw-input fld name"
          data-testid="set-name"
          aria-label={text.nameLabel}
          style:width="22ch"
          value={naming === 'new' ? '' : (set?.name ?? '')}
          onchange={(e) => void commitName(e.currentTarget.value)}
          onkeydown={nameKey}
        />{SP2}<span class="faint">{text.nameHint}</span>{:else}{#if !data.active.known && tracks.length > 0}<span class="faint"
            >{text.trackLabel}</span
          >{SP}<select
            class="pw-input fld"
            data-testid="track-picker"
            aria-label={text.trackLabel}
            style:width="16ch"
            bind:value={() => (trackId === null ? '' : String(trackId)), pickTrack}
          >
            {#each tracks as t (t)}<option value={String(t)}>{formatTrack(t)}</option>{/each}
          </select>{SP2}{:else if trackId !== null}<span>{formatTrack(trackId)}</span>{#if set !== undefined}<span class="faint"
              >{text.afterTrack}</span
            >{/if}{/if}{#if set !== undefined}<span class="faint"
            >{text.setDates(formatDay(set.createdAt), set.lastUsedAt === undefined ? undefined : formatDay(set.lastUsedAt), set.sources.length)}</span
          >{/if}{/if}
    </div>
    <!-- The bridge's reason for a rejected action; a blank line otherwise. -->
    <div class="line rejection-line">
      {SP}{#if rejection !== undefined}<span data-testid="rejection" style:color={role('warning')} title={rejection}>{rejection}</span>{/if}
    </div>

    {#if set !== undefined}
      <div class="line">{SP}<span class="faint">{text.sourcesTitle}</span>{SP}<span class="faint">{text.sourcesNote}</span></div>
      <div class="line faint">{SP3}{sourceHeader}</div>
      {#each fits as fit, i (sourceKey(fit.source))}{@render sourceLine(fit, i, 'source')}{/each}
      <div class="line">{SP}</div>
    {/if}

    <div class="line">{SP}<span class="faint">{text.suggestionsTitle}</span>{SP}<span class="faint">{text.suggestionsNote}</span></div>
    {#each suggestions as fit, i (sourceKey(fit.source))}{@render sourceLine(fit, i, 'candidate')}{:else}<div class="line faint">
        {SP3}{text.noSuggestions}
      </div>{/each}

    {#if set !== undefined}
      <div class="line">{SP}</div>
      <div class="line">{SP}<span class="faint">{text.valuesTitle}</span>{SP}<span class="faint">{text.valuesNote}</span></div>
      <div class="line faint">{SP}{valueHeader}</div>
      {#each COMPOUNDS as c (c)}
        <div class="line">{SP}{fitCell(compoundLabel(c), 3)}{#each compoundSpecs(c) as { spec } (spec.key)}{SP}{@render value(spec)}{/each}</div>
        <div class="line">
          {SP}<span class="faint">{fitCell(text.overrideRow, 3)}</span>{#each compoundSpecs(c) as { spec } (spec.key)}{SP}{@render field(spec)}{/each}
        </div>
      {/each}
      <div class="line">
        {SP}<span class="faint">{text.limitsTitle}</span>{#each LIMIT_SPECS as { name, spec } (spec.key)}{SP2}{text.limits[name]}{SP}{@render value(
            spec,
          )}{SP}{@render field(spec)}{/each}
      </div>
      <div class="line">{SP}</div>
      <div class="line">{SP}<span class="faint">{text.pitTitle}</span>{SP}<span class="faint">{text.pitNote}</span></div>
      <div class="line faint">{SP}{pitHeader}</div>
      {#each PIT_SPECS as { condition, spec } (spec.key)}
        <div class="line">{SP}{fitCell(text.conditions[condition], 5)}{SP}{@render value(spec)}{SP}{@render field(spec)}</div>
      {/each}
    {/if}
  {:else if set !== undefined}
    {#each shownFits as fit, i (sourceKey(fit.source))}{@render sourceLine(fit, i, 'source')}{/each}
    <div class="line">
      {SP}<span class="faint">{text.compactDeg}</span>{#each COMPOUNDS as c (c)}{SP}{compoundLabel(c)}{SP}{@render value(compactDegSpec(c))}{/each}
    </div>
    <div class="line">
      {SP}<span class="faint">{text.compactPit}</span>{#each PIT_SPECS as { condition, spec } (spec.key)}{SP}{text.conditions[condition]}{SP}{@render value(
          { ...spec, width: compactPitWidth },
        )}{/each}
    </div>
  {/if}
</div>

<style>
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .rejection-line {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .line :global(button),
  .fld {
    vertical-align: top;
  }
  .fld {
    height: calc(var(--pw-line) * 1em);
    text-align: right;
  }
  select.fld,
  .fld.name {
    text-align: left;
  }
  .faint {
    color: var(--pw-textFaint);
  }
  .dim {
    color: var(--pw-textDim);
  }
</style>
