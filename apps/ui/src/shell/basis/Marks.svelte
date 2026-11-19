<script lang="ts">
  // An option's marks in the picker: the team's last confirmed choice, a session stored by an older rules version (C61).
  import * as text from '../../kit/text.ts';
  import { role } from '../../theme/index.ts';

  let { lastChoice = false, stale = false }: { lastChoice?: boolean; stale?: boolean } = $props();
</script>

{#if lastChoice}<span class="mark" style:color={role('textDim')}>{text.basis.lastChoice}</span>{/if}{#if stale}<span
    class="mark"
    style:color={role('textDim')}
    title={text.basis.staleHover}>{text.basis.stale}</span
  >{/if}
