/** What `measure` reports: the node's content box in px and the current device pixel ratio. */
export type Measured = { px: { width: number; height: number }; dpr: number };

/** Svelte action: observes the node's size and the device pixel ratio, and calls `onMeasure` on change. */
export function measure(node: HTMLElement, onMeasure: (m: Measured) => void) {
  let callback = onMeasure;
  let width = node.clientWidth;
  let height = node.clientHeight;
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
