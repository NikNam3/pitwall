<script lang="ts">
  // A filled star (SP4.3b2): JetBrains Mono has no ★. Drawn in currentColor, one em square, like the gear.
  type Props = { label?: string | undefined };
  let { label }: Props = $props();
</script>

<svg
  class="star"
  viewBox="0 0 14 14"
  role={label === undefined ? 'presentation' : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
>
  <polygon points="7,1 8.76,4.57 12.71,5.15 9.86,7.93 10.53,11.85 7,10 3.47,11.85 4.14,7.93 1.29,5.15 5.24,4.57" fill="currentColor" />
</svg>

<style>
  .star {
    width: 1em;
    height: 1em;
    vertical-align: -0.15em;
  }
</style>
