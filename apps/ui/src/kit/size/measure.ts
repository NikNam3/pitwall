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

/** Svelte action: observes the node's size and the device pixel ratio, and calls `onMeasure` on change. */
export function measure(node: HTMLElement, onMeasure: (m: Measured) => void) {
  let callback = onMeasure;
  let { width, height } = contentBox(node);
  let query: MediaQueryList | undefined;

  const emit = () => callback({ px: { width, height }, dpr: window.devicePixelRatio });

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
    const box = entries[0]?.contentRect;
    if (!box) return;
    width = box.width;
    height = box.height;
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
