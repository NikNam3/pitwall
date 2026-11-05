<script lang="ts">
  // The track outline canvas (spec 7.1): not implemented yet.
  import type { TrackScene } from './types.ts';

  type Props = { scene: TrackScene };
  const props: Props = $props();
</script>

<span hidden>{props.scene.outline.length > 0 ? '' : ''}</span>
