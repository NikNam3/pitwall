<script lang="ts">
  // Position change or before/after pair as text; colour comes from the caller's context, not from the mark (spec A.4).
  import { positionMarkText, type PositionMarkProps } from './position-mark.ts';

  let props: PositionMarkProps = $props();
</script>

<span>{positionMarkText(props)}</span>
