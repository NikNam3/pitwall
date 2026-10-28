<script lang="ts">
  // The key overview (spec 7.7, `?`): the bindings grouped as the commands are, then the notes on `keys.json`.
  import * as text from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from './Overlay.svelte';
  import { KEY_COLUMN_COLS, OVERLAY_COLS } from './overlay-sizes.ts';
  import type { CommandRegistry } from './registry.ts';

  type Props = {
    registry: CommandRegistry;
    /** Key to command id. */
    bindings: ReadonlyMap<string, string>;
    /** What was ignored in `keys.json`. */
    notes: readonly string[];
    onClose: () => void;
  };
  let { registry, bindings, notes, onClose }: Props = $props();

  // Only bound commands are listed: the palette finds the others.
  const groups = $derived.by(() => {
    const byId = new Map(registry.list().map((c) => [c.id, c] as const));
    const rows = [...bindings].flatMap(([key, id]) => {
      const command = byId.get(id);
      return command === undefined ? [] : [{ group: command.group, key, title: command.title }];
    });
    const headings = [...new Set(rows.map((r) => r.group))];
    return headings.map((heading) => [heading, rows.filter((r) => r.group === heading)] as const);
  });
</script>

<Overlay title={text.keyOverviewTitle} {onClose} cols={OVERLAY_COLS.keys}>
  {#each groups as [group, rows] (group)}
    <div class="group" style:color={role('textDim')}>{group}</div>
    {#each rows as row (row.key)}
      <div class="row"><kbd style:min-width="{KEY_COLUMN_COLS}ch">{row.key}</kbd><span style:color={role('textDim')}>{row.title}</span></div>
    {/each}
  {/each}
  {#each notes as note (note)}
    <div class="group" style:color={role('warning')}>{note}</div>
  {/each}
</Overlay>

<style>
  .row {
    display: flex;
    gap: var(--pw-col-gap);
  }
  kbd {
    font-family: var(--pw-font);
    font-size: inherit;
  }
</style>
