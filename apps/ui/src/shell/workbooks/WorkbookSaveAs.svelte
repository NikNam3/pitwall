<script lang="ts">
  // The name prompt of `workbook.saveAs` (spec 7.2): Enter saves the active workbook under the typed name.
  import * as text from '../../kit/text.ts';
  import Overlay from '../commands/Overlay.svelte';

  type Props = { onSave: (name: string) => void; onClose: () => void };
  let { onSave, onClose }: Props = $props();

  let name = $state('');
  const save = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter' || name.trim() === '') return;
    onSave(name.trim());
  };
</script>

<Overlay title={text.saveAsTitle} {onClose} cols={40}>
  <!-- svelte-ignore a11y_autofocus -->
  <input type="text" autofocus spellcheck="false" aria-label={text.workbookName} bind:value={name} onkeydown={save} />
</Overlay>

<style>
  input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--pw-font);
    font-size: inherit;
    color: inherit;
    background: none;
    border: none;
    outline: none;
    padding: 0;
  }
</style>
