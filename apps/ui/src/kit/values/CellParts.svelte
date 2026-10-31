<script lang="ts">
  // The kit's one drawing of a cell's parts (review 7, R7-8): each part in order as the kit's `TextCell` shows it, a
  // known part's text, an unknown part its reason's mark (faint, the reason on hover), `separator` between neighbours.
  import type { CellPart } from '../grid/grid.ts';
  import TextCell from './TextCell.svelte';

  type Props = {
    parts: readonly CellPart[];
    /** Drawn between neighbouring parts only; none by default. */
    separator?: string;
  };
  let { parts, separator = '' }: Props = $props();
</script>

{#each parts as part, i (i)}{i === 0 ? '' : separator}<TextCell {...part} />{/each}
