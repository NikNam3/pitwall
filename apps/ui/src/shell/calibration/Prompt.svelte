<script lang="ts">
  // The calibration prompt (SP4.1a spec 3.3, mockup start-prompt.html): the session track's sets, the preselection
  // marked, and `defaults` last. Every row invokes its command by id (C72); ↑↓ move the cursor, Enter chooses.
  // Escape (through the shell's overlay stack) or a click outside closes it and keeps what the run uses.
  import type { CalibrationSet, SessionKind } from '@pitwall/domain';
  import { formatDay, formatSessionKind, formatTrack } from '../../kit/values/format.ts';
  import * as text from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import { calibrationChooseId } from '../commands/default-commands.ts';
  import Overlay from '../commands/Overlay.svelte';
  import { OVERLAY_COLS } from '../commands/overlay-sizes.ts';

  type Props = {
    /** The sets of the session's track, in the order of `calibration.sets`. */
    sets: readonly CalibrationSet[];
    /** Per set id, how many of its sources are skipped as `missing` (`calibration.values`). */
    missing: ReadonlyMap<string, number>;
    trackId: number;
    /** The session's kind as the top bar's session segment names it (`sessionOf`); undefined while pending or `none`. */
    session: SessionKind | undefined;
    /** The set the run uses (`null`: defaults), and whether a pick chose it rather than the preselection. */
    activeSetId: string | null;
    picked: boolean;
    /** Runs a command by id. */
    run: (commandId: string) => void;
    onClose: () => void;
  };
  let { sets, missing, trackId, session, activeSetId, picked, run, onClose }: Props = $props();

  const title = $derived(text.calibration.promptTitle(formatTrack(trackId), session === undefined ? undefined : formatSessionKind(session)));

  type Row = { setId: string | null; name: string };
  const rows = $derived<Row[]>([...sets.map((s) => ({ setId: s.id, name: s.name })), { setId: null, name: text.calibration.defaults }]);
  const activeAt = (): number => Math.max(0, rows.findIndex((r) => r.setId === activeSetId));
  /** Starts on the set the run uses. */
  let cursor = $state(activeAt());
  const kept = $derived(rows.find((r) => r.setId === activeSetId)?.name ?? text.calibration.defaults);

  const choose = (row: Row | undefined): void => {
    if (row !== undefined) run(calibrationChooseId(row.setId));
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') cursor = Math.min(cursor + 1, rows.length - 1);
    else if (e.key === 'ArrowUp') cursor = Math.max(cursor - 1, 0);
    else if (e.key === 'Enter') choose(rows[cursor]);
    else return;
    e.preventDefault();
  };

  let list = $state<HTMLElement>();
  $effect(() => list?.focus());

  const dayOf = (set: CalibrationSet): string =>
    set.lastUsedAt !== undefined ? text.calibration.used(formatDay(set.lastUsedAt)) : text.calibration.created(formatDay(set.createdAt));
</script>

<Overlay {title} {onClose} cols={OVERLAY_COLS.calibration}>
  <!-- The list holds the focus: the keys go to it. -->
  <ul bind:this={list} data-testid="calibration-prompt" tabindex="-1" role="listbox" onkeydown={onKey}>
    {#each rows as row, i (row.setId)}
      {@const set = sets.find((s) => s.id === row.setId)}
      {@const lost = row.setId === null ? 0 : (missing.get(row.setId) ?? 0)}
      <li role="option" aria-selected={i === cursor}>
        <button
          type="button"
          class="pw-button"
          class:cursor={i === cursor}
          tabindex="-1"
          data-testid="calibration-choice-{row.setId ?? 'defaults'}"
          style:color={role(i === cursor ? 'text' : 'textDim')}
          onclick={() => choose(row)}
        >
          <span class="name">{row.name}</span>
          {#if set === undefined}
            <span class="note" style:color={role('textFaint')}>{text.calibration.defaultsNote}</span>
          {:else}
            <span style:color={role('textFaint')}>{text.calibration.sources(set.sources.length)}</span>
            <span style:color={role('warning')} title={lost > 0 ? text.calibration.missingHover : undefined}>{lost > 0 ? text.calibration.missing(lost) : ''}</span>
            <span style:color={role('textFaint')}>{dayOf(set)}</span>
          {/if}
          {#if !picked && row.setId === activeSetId}
            <span class="mark" style:color={role('textFaint')} title={text.calibration.preselectedHover}>{text.calibration.preselected}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
  <div style:color={role('textFaint')}>{text.calibration.footer(kept)}</div>
</Overlay>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    outline: none;
  }
  button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 10ch 10ch 12ch 11ch;
    gap: 1ch;
    width: 100%;
    text-align: left;
    white-space: nowrap;
  }
  button.cursor {
    background: var(--pw-bgBand);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note {
    grid-column: 2 / 5;
  }
  .mark {
    grid-column: 5;
  }
</style>
