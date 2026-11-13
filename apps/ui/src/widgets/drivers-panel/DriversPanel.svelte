<script lang="ts">
  // The drivers panel (SP4.3b spec §10; mockup docs/design/2026-11-12-sp4.3b/drivers-panel.html): the seats with the
  // person each is linked to, per person its profile entries with an override field each and its linked sessions with an
  // exclude toggle each; read-only below, the lobby settings and the feed's effective config. Every control sends one
  // `drivers.*` uiAction and takes effect when the bridge publishes it (C62c, C73); the new-person field and a draft are
  // window-local, a rejected draft stays with the bridge's reason in the warning role until the next edit.
  import type { UiAction } from '@pitwall/contracts';
  import type { LinkedSession, PersonId } from '@pitwall/domain';
  import { getUiActions } from '../../kit/actions.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { arrow } from '../../kit/text.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import { formatCount, formatDay, formatRaceNumber, formatShort, formatTrack, formatWeekendPhase } from '../../kit/values/format.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role } from '../../theme/index.ts';
  import { entriesOf, entryText, overrideAction, overrideText, seatKey, seatsOf, type EntrySpec, type Person, type Seat } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const { send } = getUiActions();

  /** Column widths of a person's entries (mockup). */
  const W = { label: 13, value: 6, laps: 4, ses: 3, newest: 6, ovr: 7 } as const;
  /** Column widths of a linked session. */
  const S = { day: 6, track: 9, phase: 6, laps: 4 } as const;
  /** Column widths of the lobby and the config. */
  const L = { label: 12, word: 20 } as const;
  const K = { unit: 16, key: 19, value: 6 } as const;
  /** The compact mode's columns: `#12 Mercedes kuh      5  214`. */
  const C = { number: 3, team: 8, person: 8, ses: 3, laps: 4 } as const;
  /** A seat's column in full mode: two side by side in the 92 columns. */
  const COLUMN_WIDTH = 46;
  const PICKER_WIDTH = 10;
  /** Character cells of space: Svelte trims whitespace at a tag's edges, so the lines spell theirs out. */
  const SP = ' ';
  const NEW = ':new';
  const NONE = ':none';

  const full = $derived(size.mode === 'full');
  const persons = $derived(data.profiles.persons);
  const seats = $derived(seatsOf(data.links));
  const personById = (id: PersonId | null): Person | undefined => (id === null ? undefined : persons.find((p) => p.person === id));
  /** Each person's details show once: under the first seat linked to them, or in a column of their own without a seat. */
  const detailSeat = $derived(new Map(seats.toReversed().flatMap((s) => (s.person === null ? [] : [[s.person, seatKey(s)] as const]))));
  const unseated = $derived(persons.filter((p) => !detailSeat.has(p.person)));
  /**
   * The full mode's columns, two side by side: each seat with the person whose details it shows; a person without a seat
   * fills the first seat column without details (under their name), else a column of their own, so an unlinked seat and
   * an unseated person take one column and the panel keeps two (fit: full/unlinkedSeat, full/noSession).
   */
  type Column = { key: string; seat: Seat | undefined; person: Person | undefined; named: boolean };
  const columns = $derived.by((): Column[] => {
    const cols: Column[] = seats.map((s) => {
      const k = seatKey(s);
      const person = detailSeat.get(s.person ?? '') === k ? personById(s.person) : undefined;
      return { key: k, seat: s, person, named: false };
    });
    for (const p of unseated) {
      const free = cols.find((c) => c.person === undefined);
      if (free !== undefined) Object.assign(free, { person: p, named: true });
      else cols.push({ key: `person-${p.person}`, seat: undefined, person: p, named: true });
    }
    return cols;
  });
  const lobbyKeys = Object.keys(text.lobbyLabels) as text.LobbyKey[];
  const configRows = $derived(
    data.config === undefined
      ? []
      : Object.entries(data.config.values).flatMap(([unit, values]) =>
          Object.entries(values).map(([key, value], i) => ({
            unit, key, first: i === 0, value: typeof value === 'string' ? value : formatShort(value, K.value),
            set: data.config?.overridden[unit]?.includes(key) ?? false,
          })),
        ),
  );
  const compactSeats = $derived(seats.slice(0, Math.max(0, size.rows - 1)));

  // Window-local state (C73): the seat whose new-person field is open, the drafts of the override fields, the warning.
  let naming = $state<string | undefined>(undefined);
  let drafts = $state<Record<string, string>>({});
  let warning = $state<string | undefined>(undefined);
  let nameField = $state<HTMLInputElement>();

  $effect(() => nameField?.focus());

  /** Sends an action; a rejection shows the bridge's reason. Resolves whether the bridge accepted it. */
  async function act(action: UiAction): Promise<boolean> {
    warning = undefined;
    const outcome = await send(action);
    if (outcome.ok) return true;
    warning = text.rejected(outcome.reason === 'linkLost' ? text.linkLost : (outcome.message ?? text.rejectedNoReason));
    return false;
  }

  function pick(seat: Seat, value: string): void {
    if (value === NEW) {
      naming = seatKey(seat);
      return;
    }
    void act({ kind: 'drivers.link', team: seat.team, raceNumber: seat.raceNumber, person: value === NONE ? null : value });
  }
  async function commitName(seat: Seat, typed: string): Promise<void> {
    const displayName = typed.trim();
    if (displayName === '') return;
    if (await act({ kind: 'drivers.add', displayName, seat: { team: seat.team, raceNumber: seat.raceNumber } })) naming = undefined;
  }
  function nameKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') naming = undefined;
  }

  const draftKey = (person: Person, spec: EntrySpec): string => `${person.person}/${spec.key}`;
  function editOverride(person: Person, spec: EntrySpec, typed: string): void {
    drafts[draftKey(person, spec)] = typed;
    warning = undefined;
  }
  async function commitOverride(person: Person, spec: EntrySpec, typed: string): Promise<void> {
    const k = draftKey(person, spec);
    drafts[k] = typed;
    const action = overrideAction(spec, typed, person.person, person.overrides);
    if (action === 'notANumber') {
      warning = text.rejected(text.notANumber);
      return;
    }
    if (action === undefined || (await act(action))) dropDraft(k);
  }
  function dropDraft(k: string): void {
    drafts = Object.fromEntries(Object.entries(drafts).filter(([d]) => d !== k));
  }

  function toggleSession(person: Person, s: LinkedSession): void {
    void act({ kind: s.excluded ? 'drivers.include' : 'drivers.exclude', person: person.person, session: s.session });
  }

  const header = (cells: [string, number, 'left' | 'right'][]): string => cells.map(([t, w, a]) => fitCell(t, w, a)).join(SP);
  const entryHeader = header([
    [text.entryHeaders.entry, W.label, 'left'], [text.entryHeaders.value, W.value, 'right'], [text.entryHeaders.laps, W.laps, 'right'],
    [text.entryHeaders.ses, W.ses, 'right'], [text.entryHeaders.newest, W.newest, 'left'], [text.entryHeaders.ovr, W.ovr, 'left'],
  ]);
  const configHeader = header([
    [text.configHeaders.unit, K.unit, 'left'], [text.configHeaders.key, K.key, 'left'], [text.configHeaders.value, K.value, 'right'],
  ]);
  const compactHeader = `${fitCell('', 1 + C.number + 1 + C.team + 1 + C.person)}${fitCell(text.compactHeaders.ses, C.ses, 'right')}${SP}${fitCell(text.compactHeaders.laps, C.laps, 'right')}`;
</script>

{#snippet entries(person: Person)}
  <div class="line faint">{SP}{entryHeader}</div>
  {#each entriesOf(person) as { spec, entry } (spec.key)}
    {@const override = person.overrides[spec.key]}
    {@const value = entry.value}
    <div class="line" data-testid="entry-row-{person.person}-{spec.key}">
      {SP}<span class="dim">{fitCell(spec.label, W.label)}</span>{SP}<span data-testid="entry-{person.person}-{spec.key}"
        >{#if value.known}<TextCell
            text={entryText(spec, value.value)}
            width={W.value}
            align="right"
            role={override === undefined ? undefined : 'textFaint'}
            title={override === undefined ? undefined : text.overrideHover(entryText(spec, override))}
          />{:else}<TextCell text="" reason={value.reason} width={W.value} align="right" />{/if}</span
      >{SP}{#if value.known}{fitCell(formatCount(entry.laps), W.laps, 'right')}{SP}{fitCell(formatCount(entry.sessions), W.ses, 'right')}{SP}{fitCell(
          formatDay(entry.newestSession),
          W.newest,
        )}{:else}{fitCell('', W.laps + 1 + W.ses + 1 + W.newest)}{/if}{SP}<span class="ovr" style:width="{W.ovr}ch"
        ><input
          type="text"
          inputmode="decimal"
          spellcheck="false"
          class="pw-input fld"
          data-testid="override-{person.person}-{spec.key}"
          aria-label={spec.label}
          title={text.overrideFieldHover(spec.label)}
          style:width="{W.ovr - 2}ch"
          value={drafts[draftKey(person, spec)] ?? overrideText(spec, person.overrides)}
          oninput={(e) => editOverride(person, spec, e.currentTarget.value)}
          onchange={(e) => void commitOverride(person, spec, e.currentTarget.value)}
        /></span
      >
    </div>
  {/each}
{/snippet}

{#snippet sessions(person: Person)}
  <div class="line">{SP}<span class="faint">{text.sessionsTitle}</span></div>
  {#each person.sessions as s, i (i)}
    <div class="line" data-testid="session-{person.person}-{i}">
      {SP}<button
        type="button"
        class="pw-button"
        class:dim={s.excluded}
        data-testid="session-toggle-{person.person}-{i}"
        title={s.excluded ? text.includeHover : text.excludeHover}
        onclick={() => toggleSession(person, s)}>{s.excluded ? text.sessionToggle.excluded : text.sessionToggle.kept}</button
      >{SP}<span class:faint={s.excluded}
        >{fitCell(formatDay(s.date), S.day)}{SP}{fitCell(formatTrack(s.trackId), S.track)}{SP}{fitCell(formatWeekendPhase(s.phase), S.phase)}{SP}{fitCell(
          formatCount(s.laps),
          S.laps,
          'right',
        )}</span
      >
    </div>
  {/each}
{/snippet}

{#snippet seatLine(seat: Seat)}
  {@const k = seatKey(seat)}
  <div class="line" data-testid="seat-{k}">
    {SP}<span class="faint">{formatRaceNumber(seat.raceNumber)}</span>{SP}{text.teamName(seat.team)}{SP}{arrow}{SP}{#if naming === k}<input
        bind:this={nameField}
        type="text"
        spellcheck="false"
        class="pw-input fld name"
        data-testid="new-name-{k}"
        aria-label={text.pickNew}
        title={text.nameHover}
        style:width="{PICKER_WIDTH + 4}ch"
        onchange={(e) => void commitName(seat, e.currentTarget.value)}
        onkeydown={nameKey}
      />{:else}<span class="picker"><select
          class="pw-input fld"
          data-testid="link-{k}"
          aria-label={text.pickerHover}
          title={text.pickerHover}
          style:width="{PICKER_WIDTH}ch"
          bind:value={() => seat.person ?? NONE, (v: string) => pick(seat, v)}
        >
          {#each persons as p (p.person)}<option value={p.person}>{p.displayName}</option>{/each}
          <option value={NEW}>{text.pickNew}</option>
          <option value={NONE}>{text.pickNone}</option>
        </select><span class="arrow" aria-hidden="true">{text.pickerArrow}</span></span>{/if}
  </div>
{/snippet}

<div class="block">
  {#if full}
    <div class="line">{SP}<span class="faint">{text.seatsTitle}</span></div>
    <div class="cols">
      {#each columns as col (col.key)}
        <div class="col" style:width="{COLUMN_WIDTH}ch">
          {#if col.seat !== undefined}{@render seatLine(col.seat)}{/if}
          {#if col.person !== undefined}
            {#if col.named}<div class="line">{SP}{col.person.displayName}</div>{/if}
            {@render entries(col.person)}
          {/if}
        </div>
      {/each}
    </div>
    <!-- The bridge's reason for a rejected edit; a blank line otherwise. -->
    <div class="line warning-line">
      {SP}{#if warning !== undefined}<span data-testid="warning" title={warning}><span style:color={role('warning')}>{warning}</span></span>{/if}
    </div>
    <div class="cols">
      {#each columns as col (col.key)}
        <div class="col" style:width="{COLUMN_WIDTH}ch">{#if col.person !== undefined}{@render sessions(col.person)}{/if}</div>
      {/each}
    </div>
    <div class="line">{SP}</div>

    <div class="cols">
      <div class="col" style:width="{1 + L.label + 1 + L.word + 1}ch">
        <div class="line">{SP}<span class="faint">{text.lobbyTitle}</span></div>
        {#each lobbyKeys as k (k)}
          {@const settings = data.session?.session.settings}
          <div class="line">
            {SP}<span class="dim">{fitCell(text.lobbyLabels[k], L.label)}</span>{SP}<span data-testid="lobby-{k}"
              >{#if settings === undefined}<span title={text.noSessionHover}><TextCell text="" reason="notApplicable" /></span
                >{:else}{(text.lobbyWords[k] as Record<string, string>)[settings[k]] ?? String(settings[k])}{/if}</span
            >
          </div>
        {/each}
      </div>
      <div class="col">
        <div class="line">{SP}<span class="faint">{text.configTitle}</span></div>
        {#if data.config === undefined}
          <div class="line">
            {SP}<span data-testid="config-unknown" title={text.noConfigHover}><TextCell text="" reason="notApplicable" /></span>
          </div>
        {:else}
          <div class="line faint">{SP}{configHeader}</div>
          {#each configRows as r (`${r.unit}/${r.key}`)}
            <div class="line">
              {SP}<span class="dim">{fitCell(r.first ? r.unit : '', K.unit)}</span>{SP}<span class="dim">{fitCell(r.key, K.key)}</span>{SP}<span
                data-testid="config-{r.unit}-{r.key}"
                title={r.set ? text.configSetHover : undefined}
                ><span style:color={role(r.set ? 'text' : 'textDim')}>{fitCell(r.value, K.value, 'right')}</span>{#if r.set}<span class="dim"
                    >{text.configSetMark}</span
                  >{/if}</span
              >
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {:else}
    <div class="line faint">{compactHeader}</div>
    {#each compactSeats as seat (seatKey(seat))}
      {@const person = personById(seat.person)}
      <div class="line" data-testid="compact-seat-{seatKey(seat)}">
        {SP}<span class="faint">{fitCell(formatRaceNumber(seat.raceNumber), C.number)}</span>{SP}{fitCell(text.teamName(seat.team), C.team)}{SP}{#if person === undefined}<span
            title={text.unlinkedHover}><TextCell text="" reason="notApplicable" width={C.person} /></span
          >{:else}{fitCell(person.displayName, C.person)}{fitCell(formatCount(person.kept.sessions), C.ses, 'right')}{SP}{fitCell(
            formatCount(person.kept.laps),
            C.laps,
            'right',
          )}{/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
  }
  .col {
    flex: none;
  }
  .warning-line {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .line :global(button),
  .fld {
    vertical-align: top;
  }
  /* One character cell tall: the browser's minimum size of a customisable select (24 px) would make its line taller. */
  .fld {
    height: calc(var(--pw-line) * 1em);
    min-height: 0;
    text-align: right;
  }
  select.fld,
  .fld.name {
    text-align: left;
  }
  /* An override field: the frame one cell wider than the value on each side (mockup `│0.380│` in 7 cells); the input
     inside it is frameless, so a five-character value never reaches the frame. */
  .ovr {
    display: inline-flex;
    justify-content: center;
    vertical-align: top;
    box-sizing: border-box;
    height: calc(var(--pw-line) * 1em);
    border: var(--pw-border-px) solid var(--pw-border);
  }
  .ovr .fld {
    border: none;
    height: 100%;
  }
  .ovr:focus-within {
    outline: var(--pw-border-px) solid var(--pw-focus);
  }
  /* The picker: its text one cell from its frame and the mockup's small arrow at its right edge (` kuh ▾`), in place of
     the browser's own icon. */
  .picker {
    position: relative;
    display: inline-block;
    vertical-align: top;
  }
  .picker select.fld {
    text-indent: 1ch;
  }
  .picker select.fld::picker-icon {
    display: none;
  }
  .arrow {
    position: absolute;
    top: 0;
    right: 1ch;
    pointer-events: none;
  }
  .faint {
    color: var(--pw-textFaint);
  }
  .dim {
    color: var(--pw-textDim);
  }
</style>
