<script lang="ts">
  // Test-only parent of CornerGrid: each cell prints `<name>=<value>`.
  import type { Corners } from '@pitwall/domain';
  import CornerGrid from '../../src/kit/corners/CornerGrid.svelte';

  let { corners }: { corners: Corners<number> } = $props();
</script>

{#snippet cell(value: number, name: keyof Corners<number>)}{name}={value}{/snippet}

<CornerGrid {corners} {cell} />
