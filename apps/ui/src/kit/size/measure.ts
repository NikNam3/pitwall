/** What `measure` reports: the node's content box in px and the current device pixel ratio. */
export type Measured = { px: { width: number; height: number }; dpr: number };

/** The node's content box: client size minus padding, the same box `ResizeObserver` reports as `contentRect`. */
function contentBox(node: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(node);
  const px = (value: string): number => parseFloat(value) || 0;
  return {
    width: Math.max(0, node.clientWidth - px(style.paddingLeft) - px(style.paddingRight)),
    height: Math.max(0, node.clientHeight - px(style.paddingTop) - px(style.paddingBottom)),
  };
}

/**
 * Svelte action: observes the node's size and the device pixel ratio, and calls `onMeasure` on change. The size comes
 * from the observer, whose first report follows the next layout; the node's box is read only for a pixel ratio change
 * before that report. Reading it when the action is applied would force a layout per mounted panel.
 */
export function measure(node: HTMLElement, onMeasure: (m: Measured) => void) {
  let callback = onMeasure;
  let box: { width: number; height: number } | undefined;
  let query: MediaQueryList | undefined;

  const emit = () => callback({ px: box ?? contentBox(node), dpr: window.devicePixelRatio });

  const onDprChange = () => {
    emit();
    watchDpr();
  };
  const watchDpr = () => {
    query?.removeEventListener('change', onDprChange);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', onDprChange, { once: true });
  };

  const observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (!rect) return;
    box = { width: rect.width, height: rect.height };
    emit();
  });
  observer.observe(node);
  watchDpr();

  return {
    update(next: (m: Measured) => void) {
      callback = next;
    },
    destroy() {
      observer.disconnect();
      query?.removeEventListener('change', onDprChange);
    },
  };
}
