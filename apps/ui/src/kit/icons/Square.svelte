<script lang="ts">
  // A filled square (SP4.3b2): JetBrains Mono has no ■. Drawn in currentColor, one em square, like the gear.
  type Props = { label?: string | undefined };
  let { label }: Props = $props();
</script>

<svg
  class="square"
  viewBox="0 0 14 14"
  role={label === undefined ? 'presentation' : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
>
  <rect x="3" y="3" width="8" height="8" fill="currentColor" />
</svg>

<style>
  .square {
    width: 1em;
    height: 1em;
    vertical-align: -0.15em;
  }
</style>
