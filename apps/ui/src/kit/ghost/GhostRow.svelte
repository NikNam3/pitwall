<script lang="ts">
  // A ghost's row (SP4.2 spec §5, B1): its cells in the ghost role, between two 1 px hairlines in the same role.
  import type { Snippet } from 'svelte';
  import { role } from '../../theme/index.ts';
  import { GHOST_ROLE } from './ghost.ts';

  type Props = { children: Snippet };
  let { children }: Props = $props();

  const faint = role(GHOST_ROLE);
</script>

<div class="ghost">
  <div data-hairline style:height="1px" style:background-color={faint}></div>
  <div data-ghost-row style:color={faint}>{@render children()}</div>
  <div data-hairline style:height="1px" style:background-color={faint}></div>
</div>

<style>
  .ghost {
    display: flex;
    flex-direction: column;
  }
</style>
