// When a gallery cell counts as rendered: the e2e harness waits for `data-ready` on every cell before it checks or
// screenshots them.

/** Resolves after two animation frames: by then whatever a settled promise changed has been laid out and painted. */
export const afterFrames = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
