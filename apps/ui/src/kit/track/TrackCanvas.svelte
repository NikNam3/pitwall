<script lang="ts">
  // The track outline canvas (spec 7.1): measures its box, lays the scene out (`layoutTrack`, pure) and draws it
  // through the kit's canvas: the outline in its line role, the stretches over it in theme roles, the labels, the
  // marker triangles with their labels, the dots in their car colour (resolved as the chart resolves it), the side
  // bars and the ghost rings (`drawGhostRing`). Colours only as theme roles or a dot's team colour (C68).
  import { DEFAULT_THEME, cssNumber, resolveColour } from '../../theme/index.ts';
  import Canvas from '../canvas/Canvas.svelte';
  import type { DrawApi } from '../canvas/types.ts';
  import { measure } from '../size/measure.ts';
  import type { Measured } from '../size/measure.ts';
  import { cellBox, toCells } from '../size/size.ts';
  import type { WidgetSize } from '../types.ts';
  import { drawGhostRing } from './ghost-ring.ts';
  import { TRACK_PX, ghostsOf, layoutTrack, stretchPoints, triangleBox } from './layout.ts';
  import type { TrackScene } from './types.ts';

  type Props = { scene: TrackScene };
  let { scene }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let measured: Measured | undefined = $state();

  /** The measured box as the kit's canvas takes it. */
  const size: WidgetSize | undefined = $derived.by(() => {
    if (!host || !measured) return undefined;
    const fontPx = cssNumber(host, '--pw-font-px', DEFAULT_THEME.fontPx);
    const line = cssNumber(host, '--pw-line', DEFAULT_THEME.density.lineHeight);
    return { mode: 'track', ...toCells(measured.px, cellBox(fontPx, line)), px: measured.px, dpr: measured.dpr };
  });

  /** A closed or open path through px points. */
  function path(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], closed: boolean): void {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (closed) ctx.closePath();
  }

  function draw(ctx: CanvasRenderingContext2D, api: DrawApi): void {
    const el = host;
    if (!el || !size) return;
    const placed = layoutTrack(scene, size.px, (s) => ctx.measureText(s).width, api.cell.height);
    const { toPx } = placed;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.strokeStyle = api.role(scene.lineRole);
    ctx.lineWidth = TRACK_PX.line;
    path(ctx, scene.outline.map(toPx), true);
    ctx.stroke();

    ctx.lineWidth = TRACK_PX.stretch;
    for (const s of scene.stretches) {
      const points = stretchPoints(scene.outline, s);
      if (points.length < 2) continue;
      ctx.strokeStyle = api.role(s.role);
      path(ctx, points.map(toPx), false);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const half = api.cell.height / 2;
    ctx.fillStyle = api.role('textFaint');
    for (const l of placed.labels) ctx.fillText(l.text, l.x, l.y + half);

    ctx.lineWidth = TRACK_PX.triangleLine;
    scene.markers.forEach((m) => {
      const b = triangleBox(toPx(m.at));
      ctx.strokeStyle = api.role(m.role);
      path(ctx, [{ x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }], true);
      ctx.stroke();
    });
    placed.markerLabels.forEach((l) => {
      const m = scene.markers.find((k) => k.label === l.text);
      ctx.fillStyle = api.role(m?.role ?? 'text');
      ctx.fillText(l.text, l.x, l.y + half);
    });

    ctx.lineWidth = TRACK_PX.ring;
    for (const d of scene.dots) {
      const c = toPx(d.at);
      const colour = resolveColour(el, d.colour.colour);
      ctx.beginPath();
      ctx.arc(c.x, c.y, d.radiusPx, 0, Math.PI * 2);
      if (d.hollow) {
        ctx.strokeStyle = colour;
        ctx.stroke();
      } else {
        ctx.fillStyle = colour;
        ctx.fill();
      }
    }

    for (const b of placed.bars) {
      ctx.fillStyle = api.role(b.role);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    for (const g of ghostsOf(scene)) drawGhostRing(ctx, toPx(g.at), g.letter, api.role);
  }
</script>

<div class="track" bind:this={host} use:measure={(m) => (measured = m)}>
  {#if size}
    <div class="layer"><Canvas {size} {draw} /></div>
  {/if}
</div>

<style>
  .track {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .layer {
    position: absolute;
    inset: 0;
  }
</style>
