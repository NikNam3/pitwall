<script lang="ts">
  // The track map (spec 7.2). Test-phase stub: renders nothing; the implement phase writes it.
  import type { WidgetProps } from '../../kit/types.ts';
  import type { widget } from './widget.ts';

  let { data }: WidgetProps<typeof widget> = $props();
</script>

<div class="track-map" data-has-geometry={data.geometry.known}></div>
