<script lang="ts">
  // The gallery (spec 9.1, 9.2): every widget at every declared size, on every moment and case, under every theme,
  // then the panel frame in each state, the kit parts and the shell (top bar and overlays). Every box sits on whole pixels
  // (snap.ts), so a section added or removed changes no other cell's screenshot. Dev and test builds only.
  import * as text from '../kit/text.ts';
  import { WIDGETS } from '../widgets/index.generated.ts';
  import { DEFAULT_THEME, role, THEMES } from '../theme/index.ts';
  import { widgetCells, type CellSource } from './cells.ts';
  import { FRAME_STATES, FRAME_WIDGET, MISSING_WIDGET } from './frame-states.ts';
  import GalleryCell from './GalleryCell.svelte';
  import type { GalleryOverride } from './gallery-connection.ts';
  import KitParts from './KitParts.svelte';
  import ShellCells from './ShellCells.svelte';
  import type { MomentValues } from './moment-values.ts';
  import { fontsLoaded, snapBox, snapGrid } from './snap.ts';

  /** What a widget's `gallery.ts` declares (the widgets' gallery files are only ever imported here). */
  type Declared = CellSource & { cases?: Record<string, Record<string, unknown>> | undefined };

  type Props = {
    /** Moment name to its values; the default is every file `pnpm gen:moments` wrote. */
    moments?: Record<string, MomentValues> | undefined;
  };
  let { moments: given }: Props = $props();

  const files = import.meta.glob<{ default: Declared }>('../widgets/*/gallery.ts', { eager: true });
  const momentFiles = import.meta.glob<MomentValues>('../../../../test-support/moments/*.json', { eager: true, import: 'default' });
  const generated = Object.fromEntries(Object.entries(momentFiles).map(([path, values]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), values]));
  // svelte-ignore state_referenced_locally
  const moments = given ?? generated;

  const entryOf = (name: string): Declared | undefined => files[`../widgets/${name}/gallery.ts`]?.default;

  /** The overrides of a case: each data key of the widget names the topic it replaces. */
  function overridesOf(widgetName: string, values: Record<string, unknown>): GalleryOverride[] {
    const decl = WIDGETS.find((w) => w.decl.name === widgetName)?.decl;
    const data = (decl?.data ?? {}) as Record<string, { topic: GalleryOverride['topic'] }>;
    return Object.entries(values).flatMap(([key, value]) => (data[key] === undefined ? [] : [{ topic: data[key].topic, value }]));
  }

  const sections = WIDGETS.flatMap((widget) => {
    const entry = entryOf(widget.decl.name);
    return entry === undefined ? [] : [{ widget, cells: widgetCells(widget, entry, THEMES), entry }];
  });
  const frameWidget = WIDGETS.find((w) => w.decl.name === FRAME_WIDGET);
  const frameSize = frameWidget?.decl.sizes['full'] ?? { minCols: 1, minRows: 1 };
  /** Drawn once the font is in, so every cell is measured (and snapped to whole pixels) in it. */
  const fonts = fontsLoaded();
  let drawn = $state(fonts === undefined);
  void fonts?.then(() => (drawn = true));
</script>

{#if drawn}
  <main style:color={role('text')}>
    {#each sections as { widget, cells, entry } (widget.decl.name)}
      <section>
        <h2 use:snapBox style:color={role('textDim')}>{widget.decl.name}</h2>
        <div class="grid" use:snapGrid>
          {#each cells as cell (cell.id)}
            {#if cell.data.kind === 'moment' && moments[cell.data.name] === undefined}
              <figure data-gallery-id={cell.id} data-ready style:color={role('warning')}>{cell.id}: {text.momentMissing}</figure>
            {:else}
            <GalleryCell
              id={cell.id}
              theme={cell.theme}
              {widget}
              widgetName={widget.decl.name}
              cols={cell.size.cols}
              rows={cell.size.rows}
              moment={cell.data.kind === 'moment' ? (moments[cell.data.name] ?? []) : []}
              overrides={cell.data.kind === 'case' ? overridesOf(widget.decl.name, entry.cases?.[cell.data.name] ?? {}) : []}
            />
            {/if}
          {/each}
        </div>
      </section>
    {/each}
    <section>
      <h2 use:snapBox style:color={role('textDim')}>frame</h2>
      <div class="grid" use:snapGrid>
        {#each FRAME_STATES as state (state.name)}
          <GalleryCell
            id="frame/{state.name}"
            theme={DEFAULT_THEME}
            widget={state.widget ? frameWidget : undefined}
            widgetName={MISSING_WIDGET}
            cols={frameSize.minCols}
            rows={frameSize.minRows}
            moment={[]}
            overrides={state.overrides}
          />
        {/each}
      </div>
    </section>
    <section>
      <h2 use:snapBox style:color={role('textDim')}>kit</h2>
      <KitParts />
    </section>
    <section>
      <h2 use:snapBox style:color={role('textDim')}>shell</h2>
      <ShellCells {moments} />
    </section>
  </main>
{/if}

<style>
  main {
    padding: var(--pw-panel-gap);
  }
  h2 {
    margin: 0;
    font-weight: inherit;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pw-panel-gap);
  }
</style>
