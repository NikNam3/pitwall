<script lang="ts">
  // The canvas surface (spec 5): dpr scaling, redraw on size or draw change, and a role-aware drawing api.
  import { cssVar, resolveRole } from '../../theme/index.ts';
  import { cellBox } from '../size/size.ts';
  import type { DrawApi } from './types.ts';
  import type { WidgetSize } from '../types.ts';

  type Props = { size: WidgetSize; draw: (ctx: CanvasRenderingContext2D, api: DrawApi) => void };
  let { size, draw }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = size.px;
    const dpr = size.dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${cssVar(document.documentElement, '--pw-font-px')} ${cssVar(document.documentElement, '--pw-font')}`;
    const el = canvas;
    const root = document.documentElement;
    const fontPx = parseFloat(cssVar(root, '--pw-font-px'));
    const line = parseFloat(cssVar(root, '--pw-line'));
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
