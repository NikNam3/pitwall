<script lang="ts">
  // One gallery cell of the shell (spec 10): a stage of fixed character cells under the default theme, in which the top
  // bar or an overlay is drawn as in a window. An overlay is `position: fixed`; `contain: layout` makes the stage its
  // containing block, and once drawn the stage shrinks to the overlay's height.
  import { onMount, tick, type Snippet } from 'svelte';
  import { cellBox } from '../kit/size/size.ts';
  import { role, type ThemeVariant } from '../theme/index.ts';
  import { provideWindowFont } from '../shell/panel/window-font.ts';
  import { SUBPIXEL_PX } from './layout.ts';
  import { afterFrames } from './ready.ts';
  import { themed } from './theme-action.ts';

  type Props = {
    id: string;
    theme: ThemeVariant;
    /** Width of the stage in character cells. */
    cols: number;
    /** Stage height in character cells while an overlay is not drawn yet; unused when the content is in the flow. */
    rows?: number;
    /** True for an overlay: the stage then takes the height of its box. */
    overlay?: boolean;
    /** Runs once the content is mounted, before the cell counts as ready. */
    prepare?: (stage: HTMLElement) => void | Promise<void>;
    children: Snippet;
  };
  let { id, theme, cols, rows = 4, overlay = false, prepare, children }: Props = $props();

  /* svelte-ignore state_referenced_locally */
  const font = { fontPx: theme.fontPx, lineHeight: theme.density.lineHeight };
  provideWindowFont(font);
  const box = cellBox(font.fontPx, font.lineHeight);
  /* svelte-ignore state_referenced_locally */
  const width = cols * box.width + SUBPIXEL_PX;

  let stage = $state<HTMLElement>();
  let height = $state<number | undefined>(undefined);
  let ready = $state(false);
  onMount(() => {
    let live = true;
    void (async () => {
      await tick();
      // The stage is gone when the cell was destroyed while it waited.
      const node = stage;
      if (!live || node === undefined) return;
      await prepare?.(node);
      await afterFrames();
      const overlayBox = overlay && live ? node.querySelector<HTMLElement>('[class~="box"]') : null;
      if (overlayBox !== null) {
        height = Math.ceil(overlayBox.offsetTop + overlayBox.offsetHeight) + 1;
        await afterFrames();
      }
      if (live) ready = true;
    })();
    return () => {
      live = false;
    };
  });
</script>

<figure data-gallery-id={id} data-ready={ready || undefined} use:themed={theme}>
  <figcaption style:color={role('textFaint')}>{id}</figcaption>
  <div
    class="stage"
    bind:this={stage}
    style:width="{width}px"
    style:height={overlay ? `${height ?? rows * box.height}px` : undefined}
    style:background={role('bgPanel')}
    style:border-color={role('border')}
    style:color={role('textDim')}
  >
    {@render children()}
  </div>
</figure>

<style>
  figure {
    margin: 0;
  }
  .stage {
    position: relative;
    contain: layout;
    border: var(--pw-border-px) solid;
    box-sizing: content-box;
    font-family: var(--pw-font);
    font-size: var(--pw-font-px);
    line-height: var(--pw-line);
  }
  /* A window has room above a centred overlay; the stage shows it at the top. */
  .stage.stage :global(.centred) {
    top: 0;
  }
</style>
