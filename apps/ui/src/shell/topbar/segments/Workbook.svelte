<script lang="ts">
  // The open workbook's name, a quiet button: it opens the workbook picker (`workbook.pick`).
  import * as text from '../../../kit/text.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
</script>

{#if bar.workbookName !== undefined}
  <button type="button" class="pw-button" data-testid="workbook-name" title={text.topBar.workbookTitle} onclick={() => bar.pickWorkbook()}>{bar.workbookName}</button>
{/if}
