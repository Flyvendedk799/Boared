/** Router scroll restoration can run before a query has rendered the linked card. */
export function scrollToFragment(node: HTMLElement | null) {
  if (node && window.location.hash === "#" + node.id) {
    requestAnimationFrame(() => {
      if (node.isConnected) node.scrollIntoView({ block: "center" });
    });
  }
}
