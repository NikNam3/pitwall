<script lang="ts">
  // The workbook picker (`workbook.pick`, spec 7.2): the saved workbooks by name; choosing one opens it.
  import * as text from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from '../commands/Overlay.svelte';
  import { OVERLAY_COLS } from '../commands/overlay-sizes.ts';

  type Props = { names: readonly string[]; active: string | undefined; onPick: (name: string) => void; onClose: () => void };
  let { names, active, onPick, onClose }: Props = $props();
</script>

<Overlay title={text.workbooksTitle} {onClose} cols={OVERLAY_COLS.narrow}>
  <ul>
    {#each names as name (name)}
      <li>
        <button type="button" class="pw-button" style:color={role(name === active ? 'text' : 'textDim')} onclick={() => onPick(name)}>{name}</button>
      </li>
    {:else}
      <li style:color={role('textFaint')}>{text.noWorkbooks}</li>
    {/each}
  </ul>
</Overlay>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    width: 100%;
  }
</style>
