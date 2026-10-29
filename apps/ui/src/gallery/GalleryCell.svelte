<script lang="ts">
  // One gallery cell (spec 9.2): the real Panel on the real TopicStore, fed by a GalleryConnection, in a box of fixed
  // character cells under one theme. A real window would have a dock around it; nothing else differs.
  import { onDestroy, onMount } from 'svelte';
  import { carId, feedId } from '@pitwall/domain';
  import type { SessionInfo } from '@pitwall/contracts';
  import { TopicStore } from '../connection/topic-store.svelte.ts';
  import { cellBox } from '../kit/size/size.ts';
  import type { RegisteredWidget, ResolvedLink } from '../kit/types.ts';
  import { role, type ThemeVariant } from '../theme/index.ts';
  import Panel from '../shell/panel/Panel.svelte';
  import { defaultPanel } from '../shell/workbooks/default-panel.ts';
  import { provideWindowFont } from '../shell/panel/window-font.ts';
  import { GalleryConnection, type GalleryOverride } from './gallery-connection.ts';
  import type { MomentValues } from './moment-values.ts';
  import { SUBPIXEL_PX } from './layout.ts';
  import { afterFrames } from './ready.ts';
  import { themed } from './theme-action.ts';

  type Props = {
    id: string;
    theme: ThemeVariant;
    /** Undefined renders the panel of a widget this build lacks, named `widgetName`. */
    widget: RegisteredWidget | undefined;
    widgetName: string;
    /** True when the e2e screenshot spec compares this cell with a baseline (`data-baseline`). */
    baseline?: boolean;
    cols: number;
    rows: number;
    moment: MomentValues;
    overrides?: readonly GalleryOverride[];
  };
  let { id, theme, widget, widgetName, baseline = false, cols, rows, moment, overrides = [] }: Props = $props();

  const GALLERY_FEED = feedId('gallery');

  // The gallery is static: everything is fixed when the cell mounts.
  /* svelte-ignore state_referenced_locally */
  const font = { fontPx: theme.fontPx, lineHeight: theme.density.lineHeight };
  provideWindowFont(font);
  /* svelte-ignore state_referenced_locally */
  const store = new TopicStore(new GalleryConnection(moment, overrides));
  onDestroy(() => store.dispose());

  /* svelte-ignore state_referenced_locally */
  const playerCar = (moment.find((e) => e.topic === 'session.info')?.value as SessionInfo | undefined)?.playerCar ?? carId(0);
  const link: ResolvedLink = { group: 1, feedId: GALLERY_FEED, primary: playerCar, compare: [], window: { kind: 'live' } };
  /* svelte-ignore state_referenced_locally */
  const spec = widget === undefined ? { widget: widgetName, options: {}, linkGroup: 1 } : defaultPanel(widget.decl);

  // Ready once the widget's lazily loaded component is in and has rendered (the Panel loads the same module).
  let ready = $state(false);
  onMount(() => {
    let live = true;
    void Promise.resolve(widget?.component())
      .then(afterFrames)
      .then(() => {
        if (live) ready = true;
      });
    return () => {
      live = false;
    };
  });

  const box = cellBox(font.fontPx, font.lineHeight);
  /* svelte-ignore state_referenced_locally */
  const width = (cols + 2 * theme.density.headerPadCols) * box.width + SUBPIXEL_PX;
  /* svelte-ignore state_referenced_locally */
  const height = (rows + 1) * box.height + SUBPIXEL_PX;
</script>

<figure data-gallery-id={id} data-ready={ready || undefined} data-baseline={baseline || undefined} use:themed={theme}>
  <figcaption style:color={role('textFaint')}>{id}</figcaption>
  <div class="cell" style:width="{width}px" style:height="{height}px" style:background={role('bgPanel')} style:border-color={role('border')}>
    <Panel {store} {spec} {widget} {link} />
  </div>
</figure>

<style>
  figure {
    margin: 0;
  }
  .cell {
    border: var(--pw-border-px) solid;
    box-sizing: content-box;
    font-family: var(--pw-font);
    font-size: var(--pw-font-px);
    line-height: var(--pw-line);
  }
</style>
