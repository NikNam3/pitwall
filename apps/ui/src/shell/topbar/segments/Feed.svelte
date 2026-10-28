<script lang="ts">
  // Feed health: grey while fine, amber (warning) when the feed is stale or gone.
  import * as text from '../../../kit/text.ts';
  import { formatLoss } from '../../../kit/values/format.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();
  const feed = $derived(bar.feed);
</script>

{#if feed === undefined}
  <span style:color={role('textFaint')}>{text.topBar.feedUnknown}</span>
{:else if !feed.connected}
  <span style:color={role('warning')}>{text.topBar.feedDown}</span>
{:else if feed.stale}
  <span style:color={role('warning')}>{text.topBar.feedStale}</span>
{:else}
  <span style:color={role('textFaint')}>{text.topBar.feedOk(feed.lossPercent === undefined ? text.topBar.lossUnknown : formatLoss(feed.lossPercent))}</span>
{/if}
