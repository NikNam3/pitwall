<script lang="ts">
  // The dev inspector (spec 8.2), dev builds only: a widget's topics with live state, then binding, feature,
  // calculators with their compute times, and the file paths. Everything comes from the catalogue.
  import { TOPICS, type TopicName, type TopicValue } from '@pitwall/contracts';
  import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
  import type { ResolvedLink } from '../../kit/types.ts';
  import { formatMs } from '../../kit/values/format.ts';
  import { role } from '../../theme/index.ts';
  import type { Host } from '../host/host.ts';
  import TopicRow from './TopicRow.svelte';
  import * as text from './text.ts';

  type Catalogue = TopicValue<'dev.catalogue'>;
  type Props = {
    store: TopicStore;
    catalogue: Catalogue;
    /** The widget name of the clicked panel. */
    widget: string;
    link: ResolvedLink;
    host: Pick<Host, 'openPath'>;
    /** The params of a topic as the panel resolved them (the widget's params functions); none by default. */
    params?: (topic: string) => object;
    onClose?: () => void;
  };
  let { store, catalogue, widget, link, host, params = () => ({}), onClose }: Props = $props();

  const dev = import.meta.env.DEV;
  const entry = $derived(catalogue.widgets.find((w) => w.name === widget));
  const topics = $derived(
    (entry?.topics ?? []).map((t) => ({ name: t.topic, info: catalogue.topics.find((c) => c.name === t.topic) })),
  );
  const features = $derived(
    [...new Set(topics.flatMap((t) => (t.info?.binding === undefined ? [] : [t.info.binding.feature])))].flatMap((name) => {
      const feature = catalogue.features.find((f) => f.name === name);
      return feature === undefined ? [] : [feature];
    }),
  );
  const paths = $derived(
    [...new Set([...(entry === undefined ? [] : [entry.folder]), ...topics.flatMap((t) => (t.info === undefined ? [] : [t.info.file])), ...features.flatMap((f) => (f.strategyFolder === undefined ? [f.folder] : [f.folder, f.strategyFolder]))])],
  );

  let states = $state.raw<Record<string, EntryState<unknown>>>({});
  let calcStats = $state.raw<EntryState<TopicValue<'dev.calcStats'>> | undefined>(undefined);

  $effect(() => {
    if (!dev) return;
    const held = topics.map((t) => {
      const topic = t.name as TopicName;
      const resolved = params(t.name) as never;
      const key = TOPICS[topic]?.scope === 'global' ? { topic, params: resolved } : { topic, params: resolved, feedId: link.feedId };
      return { name: t.name, ...store.acquire(key) };
    });
    states = Object.fromEntries(held.map((h) => [h.name, h.state]));
    return () => held.forEach((h) => h.release());
  });
  $effect(() => {
    if (!dev) return;
    const held = store.acquire({ topic: 'dev.calcStats', params: {} });
    calcStats = held.state;
    return () => held.release();
  });

  const timing = (id: string): string => {
    const stat = calcStats?.value?.find((s) => s.id === id);
    if (stat === undefined) return text.notRun;
    return text.computeTime(formatMs(stat.lastMs), formatMs(stat.meanMs), stat.runs);
  };
</script>

{#if dev}
  <section data-testid="inspector" style:background={role('bgPanel')} style:color={role('text')}>
    <header style:background={role('bgBand')}>
      <span>{text.title(widget)}</span>
      {#if onClose}<button type="button" class="pw-button" onclick={onClose}>{text.close}</button>{/if}
    </header>
    {#if entry === undefined}
      <p>{text.unknownWidget(widget)}</p>
    {:else}
      <h3>{text.topicsHeading}</h3>
      <ul>
        {#each topics as t (t.name)}
          <li data-testid={`inspector-topic-${t.name}`}>
            <TopicRow
              name={t.name}
              entry={states[t.name] ?? { status: 'waiting', value: undefined }}
              maxHz={t.info?.maxHz ?? null}
              binding={t.info?.binding === undefined ? undefined : text.binding(t.info.binding.kind, t.info.binding.source)}
            />
          </li>
        {/each}
      </ul>
      {#each features as feature (feature.name)}
        <h3>{feature.name}: {text.calculatorsHeading}</h3>
        <ul>
          {#each feature.calculators as calc (calc.id)}
            <li><span>{calc.id}</span> <span>{text.reads(calc.reads)}</span> <span>{calc.cadence}</span> <span>{timing(calc.id)}</span></li>
          {/each}
        </ul>
      {/each}
      <h3>{text.filesHeading}</h3>
      <ul>
        {#each paths as path (path)}
          <li><button type="button" class="pw-button" onclick={() => host.openPath(path)}>{path}</button></li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  section {
    font-family: var(--pw-font);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
