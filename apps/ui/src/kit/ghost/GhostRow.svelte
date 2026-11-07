<script lang="ts">
  // A ghost's row (SP4.2 spec §5, B1): its cells in the ghost role, between two 1 px hairlines in the same role.
  import type { Snippet } from 'svelte';
  import { role } from '../../theme/index.ts';
  import { GHOST_ROLE } from './ghost.ts';

  type Props = { children: Snippet };
  let { children }: Props = $props();

  const faint = role(GHOST_ROLE);
</script>

<!-- The hairlines lie on the row's top and bottom edge and take no height: the ghost keeps exactly one line. -->
<div class="ghost">
  <div class="hairline top" data-hairline style:height="1px" style:background-color={faint}></div>
  <div data-ghost-row style:color={faint}>{@render children()}</div>
  <div class="hairline bottom" data-hairline style:height="1px" style:background-color={faint}></div>
</div>

<style>
  .ghost {
    position: relative;
  }
  .hairline {
    position: absolute;
    left: 0;
    right: 0;
  }
  .top {
    top: 0;
  }
  .bottom {
    bottom: 0;
  }
</style>
