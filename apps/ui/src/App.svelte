<script lang="ts">
  // The page: one connection, one topic store and the window shell (spec 6.1, 7.1).
  import { onDestroy } from 'svelte';
  import { createWsConnection } from './connection/connection.ts';
  import { TopicStore } from './connection/topic-store.svelte.ts';
  import * as text from './kit/text.ts';
  import { role } from './theme/index.ts';
  import { bridgeUrl } from './shell/bridge-url.ts';
  import { getHost } from './shell/host/host.ts';
  import WindowShell from './shell/windows/WindowShell.svelte';

  /** How long "bridge updated, reload" shows before the page reloads. */
  const RELOAD_DELAY_MS = 2000;

  // Dev builds reconnect at once: the bridge restarts often there.
  const connection = createWsConnection(bridgeUrl(location.search), import.meta.env.DEV ? { initialBackoffMs: 0 } : {});
  const store = new TopicStore(connection);

  onDestroy(() => store.dispose());

  $effect(() => {
    if (!store.contractMismatch) return;
    const timer = setTimeout(() => location.reload(), RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  });
</script>

{#if store.contractMismatch}
  <div class="notice" style:background={role('bgBand')} style:color={role('warning')}>{text.bridgeUpdated}</div>
{/if}
<!-- Panels follow the bridge's first feed until link groups name one. -->
<WindowShell {store} host={getHost()} defaultFeed={store.feeds[0]?.feedId} />

<style>
  .notice {
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 10;
    padding: 0 var(--pw-header-pad);
  }
</style>
