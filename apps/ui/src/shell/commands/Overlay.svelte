<script lang="ts">
  // A shell overlay (Task 0 overlays mockup): the panel look, a band with the title, closed by a click outside.
  // Keys are not handled here: the shell closes the overlay on Escape.
  import type { Snippet } from 'svelte';
  import { role } from '../../theme/index.ts';

  type Props = {
    title?: string | undefined;
    onClose: () => void;
    /** Top left corner in px (a popover next to its button); centred near the top when absent. */
    anchor?: { x: number; y: number } | undefined;
    /** Width in character cells. */
    cols?: number;
    children: Snippet;
  };
  let { title, onClose, anchor, cols = 60, children }: Props = $props();
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div
  class="box"
  class:centred={anchor === undefined}
  style:left={anchor === undefined ? undefined : `${anchor.x}px`}
  style:top={anchor === undefined ? undefined : `${anchor.y}px`}
  style:width="{cols}ch"
  style:background={role('bgPanel')}
  style:border-color={role('border')}
  style:color={role('text')}
>
  {#if title !== undefined}
    <div class="band" style:background={role('bgBand')} style:color={role('textDim')}>{title}</div>
  {/if}
  <div class="body">{@render children()}</div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
  }
  .box {
    position: fixed;
    z-index: 101;
    max-width: 100vw;
    max-height: 80vh;
    overflow: auto;
    border: var(--pw-border-px) solid;
    box-sizing: border-box;
  }
  .centred {
    left: 50%;
    top: 12vh;
    transform: translateX(-50%);
  }
  .band {
    padding: 0 var(--pw-header-pad);
    white-space: nowrap;
  }
  .body {
    padding: 0 var(--pw-header-pad);
  }
</style>
