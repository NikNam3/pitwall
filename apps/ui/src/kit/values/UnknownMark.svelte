<script lang="ts">
  // The cell of an unknown value in a display's own character grid: the reason's mark, faint, the reason on hover (Task P).
  import type { UnknownReason } from '@pitwall/domain';
  import { unknownShown } from './unknown-mark.ts';

  type Props = {
    reason: UnknownReason;
    /** Pads the mark with spaces to at least this many characters, the width of the cell's known text. */
    cols?: number | undefined;
    align?: 'left' | 'right' | undefined;
  };
  let { reason, cols, align = 'left' }: Props = $props();

  const shown = $derived(unknownShown(reason));
</script>

<span class="unknown" title={shown.title} style:color={shown.colour}>{align === 'right' ? shown.text.padStart(cols ?? 0) : shown.text.padEnd(cols ?? 0)}</span>
