<script lang="ts">
  // The approved settings gear (Task 0, frame B): JetBrains Mono has no gear glyph. Drawn in currentColor, one em square.
  type Props = { label?: string | undefined };
  let { label }: Props = $props();
</script>

<svg
  class="gear"
  viewBox="0 0 14 14"
  role={label === undefined ? 'presentation' : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
>
  <polygon
    points="11.90,7.00 13.47,8.29 13.10,9.53 11.07,9.72 10.46,10.46 10.67,12.49 9.53,13.10 7.96,11.81 7.00,11.90 5.71,13.47 4.47,13.10 4.28,11.07 3.54,10.46 1.51,10.67 0.90,9.53 2.19,7.96 2.10,7.00 0.53,5.71 0.90,4.47 2.93,4.28 3.54,3.54 3.33,1.51 4.47,0.90 6.04,2.19 7.00,2.10 8.29,0.53 9.53,0.90 9.72,2.93 10.46,3.54 12.49,3.33 13.10,4.47 11.81,6.04"
    fill="none"
    stroke="currentColor"
    stroke-width="1.1"
    stroke-linejoin="round"
  />
  <circle cx="7" cy="7" r="2.1" fill="none" stroke="currentColor" stroke-width="1.1" />
</svg>

<style>
  .gear {
    width: 1em;
    height: 1em;
    vertical-align: -0.15em;
  }
</style>
