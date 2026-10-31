// Gallery cells in a jsdom test: wait until they are done, the way the e2e harness waits before it checks or screenshots.
import { render } from '@testing-library/svelte';
import { afterFrames } from '../../src/gallery/ready.ts';

/**
 * Resolves once every gallery cell in `container` has `data-ready`: each widget's component is in and has rendered, each
 * chart has drawn. Nothing the cells started is still loading or drawing when the test goes on, so nothing runs after the
 * test ends. A cell that never gets ready fails the test by its timeout.
 */
export async function untilReady(container: HTMLElement): Promise<void> {
  while (container.querySelector('[data-gallery-id]:not([data-ready])') !== null) await afterFrames();
}

/** Renders like `render` and resolves once every gallery cell in it is ready (`untilReady`). */
export async function renderReady(...args: Parameters<typeof render>): Promise<ReturnType<typeof render>> {
  const view = render(...args);
  await untilReady(view.container);
  return view;
}
