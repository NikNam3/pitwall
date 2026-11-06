<script lang="ts">
  // The track map (spec 7.2, mockup 2-map-views.html without the ghost): the outline with every car at its lap
  // distance, the flagged zones and the incident markers, drawn by the kit's track canvas from `sceneOf`. Without a
  // track file the panel says "no track data"; before the geometry is in, the kit's "no data yet".
  import { noDataYet } from '../../kit/text.ts';
  import TrackCanvas from '../../kit/track/TrackCanvas.svelte';
  import type { WidgetProps } from '../../kit/types.ts';
  import { role } from '../../theme/index.ts';
  import { sceneOf } from './scene.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const geometry = $derived(data.geometry);
  const scene = $derived(geometry.known ? sceneOf(geometry.value, data.cars, data.markers, size) : undefined);
  const note = $derived(geometry.known ? undefined : geometry.reason === 'notApplicable' ? text.noTrackData : noDataYet);
</script>

<div class="track-map">
  {#if scene}
    <TrackCanvas {scene} />
  {:else}
    <div class="note" style:color={role('textDim')}>{note}</div>
  {/if}
</div>

<style>
  .track-map {
    width: 100%;
    height: 100%;
  }
  .note {
    white-space: nowrap;
  }
</style>
