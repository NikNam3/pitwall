<script lang="ts">
  // The link marker of a panel header (spec 7.4): the group number, then the primary car when it is not the player.
  // A button; it opens the group picker.
  import type { LinkGroup } from '@pitwall/contracts';
  import { untrack } from 'svelte';
  import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
  import * as text from '../../kit/text.ts';
  import type { ResolvedLink } from '../../kit/types.ts';
  import { role } from '../../theme/index.ts';
  import { carLabel } from './car-label.ts';

  type Props = {
    store: TopicStore;
    groupId: number;
    /** Undefined until the bridge published the groups. */
    group: LinkGroup | undefined;
    link: ResolvedLink | undefined;
    onOpen: (button: HTMLElement) => void;
  };
  let { store, groupId, group, link, onOpen }: Props = $props();

  const custom = $derived(group !== undefined && group.primary !== 'player' && link !== undefined);
  const feedId = $derived(custom ? link?.feedId : undefined);
  let overview = $state.raw<EntryState<Array<{ id: number; identity: { name: string } }>> | undefined>();
  $effect(() => {
    const feed = feedId;
    if (feed === undefined) {
      overview = undefined;
      return;
    }
    const held = untrack(() => store.acquire({ topic: 'cars.overview', params: {}, feedId: feed }));
    overview = held.state as typeof overview;
    return () => held.release();
  });
  const name = $derived(overview?.status === 'ok' ? overview.value?.find((c) => c.id === link?.primary)?.identity.name : undefined);
</script>

<button
  type="button"
  class="pw-button"
  aria-label="{text.linkMarker} {groupId}"
  disabled={group === undefined}
  style:color={role(custom ? 'ownCar' : 'textFaint')}
  onclick={(e) => onOpen(e.currentTarget)}
>{groupId}{#if custom}{text.separator}{name === undefined ? link?.primary : carLabel(name)}{/if}</button>

