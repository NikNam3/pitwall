<script lang="ts">
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
</script>

{#if bar.talk === 'never'}{/if}
