<script lang="ts">
  // The kit's one text cell (wave 2, T7): a display hands it a pre-formatted text, or an unknown's reason, and the cell
  // shows the text or the reason's mark (faint, the reason on hover). No display repeats that branch.
  import type { UnknownReason } from '@pitwall/domain';
  import { roleOrUndefined, type Role } from '../../theme/index.ts';
  import { fitCell } from '../grid/grid.ts';
  import { unknownShown } from './unknown-mark.ts';

  type Props = {
    /** The known text; ignored when `reason` is set. */
    text: string;
    /** Set for an unknown value: the cell shows this reason's mark, whatever `role` and `title` say. */
    reason?: UnknownReason | undefined;
    /** Exactly this many characters (padded on the `align` side, or cut with `…`); the text as given without it. */
    width?: number | undefined;
    align?: 'left' | 'right' | undefined;
    /** The known text's colour role; the inherited colour without one. */
    role?: Role | undefined;
    /** The known text's hover text. */
    title?: string | undefined;
  };
  let { text, reason, width, align = 'left', role, title }: Props = $props();

  const shown = $derived(reason === undefined ? { text, title, colour: roleOrUndefined(role) } : unknownShown(reason));
</script>

<span title={shown.title} style:color={shown.colour}>{width === undefined ? shown.text : fitCell(shown.text, width, align)}</span>
