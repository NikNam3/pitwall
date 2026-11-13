<script lang="ts">
  // The human seats of the running feeds without a linked driver (SP4.3b spec §10, README Q6 A): `unlinked n`, a quiet
  // button that invokes `drivers.open`; nothing at 0 or while `drivers.links` is unknown.
  import * as text from '../../../kit/text.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
</script>

{#if bar.unlinked !== undefined && bar.unlinked > 0}
  <button type="button" class="pw-button" data-testid="unlinked-count" title={text.commandTitles.driversOpen} onclick={() => bar.openDrivers()}
    >{text.topBar.unlinked} <span style:color={role('text')}>{bar.unlinked}</span></button
  >
{/if}
