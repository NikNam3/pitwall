<script lang="ts">
  // The calibration set the run uses, or `defaults` (SP4.1a spec 3.3, README Q5 A): a quiet button that invokes `calibration.pick`.
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
</script>

{#if bar.calibrationName !== undefined}
  <button type="button" class="pw-button" data-testid="calibration-name" title={text.commandTitles.calibrationPick} onclick={() => bar.pickCalibration()}
    >{text.calibration.label} <span style:color={role('text')}>{bar.calibrationName}</span></button
  >
{/if}
