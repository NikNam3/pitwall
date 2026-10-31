<script lang="ts">
  // The canvas surface (spec 5): dpr scaling, redraw on size or draw change, and a role-aware drawing api.
  import { DEFAULT_THEME, cssNumber, cssVar, resolveRole } from '../../theme/index.ts';
  import { cellBox } from '../size/size.ts';
  import type { DrawApi } from './types.ts';
  import type { WidgetSize } from '../types.ts';

  type Props = { size: WidgetSize; draw: (ctx: CanvasRenderingContext2D, api: DrawApi) => void };
  let { size, draw }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // a browser always gives a 2D context: none is a bug, never a silent blank canvas
    if (ctx === null) throw new Error('no 2D canvas context');
    const { width, height } = size.px;
    const dpr = size.dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the tokens as the canvas sees them, so a theme set on an ancestor (a gallery cell, a panel) counts
    const el = canvas;
    const fontPx = cssNumber(el, '--pw-font-px', DEFAULT_THEME.fontPx);
    const line = cssNumber(el, '--pw-line', DEFAULT_THEME.density.lineHeight);
    ctx.font = `${fontPx}px ${cssVar(el, '--pw-font')}`;
    const cell = cellBox(fontPx, line);
    const api: DrawApi = {
      role: (r) => resolveRole(el, r),
      cell,
      mark(x, y, opts) {
        const colour = resolveRole(el, opts.fresh === false ? 'textFaint' : (opts.role ?? 'text'));
        ctx.fillStyle = colour;
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.arc(x, y, cell.width / 2, 0, Math.PI * 2);
        ctx.fill();
        if (opts.label !== undefined) ctx.fillText(opts.label, x + cell.width, y + cell.height / 4);
      },
    };
    draw(ctx, api);
  });
</script>

<canvas bind:this={canvas} style:width="{size.px.width}px" style:height="{size.px.height}px"></canvas>

<style>
  canvas {
    display: block;
  }
</style>
