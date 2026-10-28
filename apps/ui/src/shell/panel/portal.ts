/**
 * Svelte action: moves `node` into `target` (the dock's tab, so the header band is also the drag handle) and back
 * when `target` is undefined. The node must not be the first or last node of its component, which Svelte removes by
 * walking siblings; on destroy the node is removed wherever it is.
 */
export function portal(node: HTMLElement, target: HTMLElement | undefined) {
  const home = node.parentNode;
  const placeholder = document.createComment('portal');
  home?.insertBefore(placeholder, node);

  const place = (to: HTMLElement | undefined): void => {
    if (to === undefined) placeholder.parentNode?.insertBefore(node, placeholder.nextSibling);
    else to.appendChild(node);
  };
  place(target);

  return {
    update(next: HTMLElement | undefined) {
      place(next);
    },
    destroy() {
      node.remove();
      placeholder.remove();
    },
  };
}
