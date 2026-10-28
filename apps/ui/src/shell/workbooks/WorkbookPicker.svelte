<script lang="ts">
  // The workbook picker (`workbook.pick`, spec 7.2): the saved workbooks by name; choosing one opens it.
  import * as text from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';
  import Overlay from '../commands/Overlay.svelte';

  type Props = { names: readonly string[]; active: string | undefined; onPick: (name: string) => void; onClose: () => void };
  let { names, active, onPick, onClose }: Props = $props();
</script>

<Overlay title={text.workbooksTitle} {onClose} cols={40}>
  <ul>
    {#each names as name (name)}
      <li>
        <button type="button" style:color={role(name === active ? 'ownCar' : 'text')} onclick={() => onPick(name)}>{name}</button>
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
    font-family: var(--pw-font);
    font-size: inherit;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
</style>
