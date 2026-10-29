<script lang="ts" generics="T">
  // Four corner cells laid out as the car: FL FR / RL RR (spec 8.4, A.4). The cell content is the caller's snippet.
  import type { Snippet } from 'svelte';
  import type { Corners } from '@pitwall/domain';

  type Props = { corners: Corners<T>; cell: Snippet<[T, keyof Corners<T>]> };
  let { corners, cell }: Props = $props();
  const order = ['fl', 'fr', 'rl', 'rr'] as const;
</script>

<div class="corners">
  {#each order as name (name)}
    <div data-corner={name}>{@render cell(corners[name], name)}</div>
  {/each}
</div>

<style>
  .corners {
    display: inline-grid;
    grid-template-columns: repeat(2, auto);
    column-gap: 2ch;
  }
</style>
