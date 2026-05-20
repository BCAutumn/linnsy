/** Portal overlays here so they inherit `.linnsy-window` theme tokens (see `tokens.css`). */
export function getLinnsyPortalRoot(triggerRoot: HTMLElement | null): HTMLElement {
  return triggerRoot?.closest('.linnsy-window')
    ?? document.querySelector('.linnsy-window')
    ?? document.body;
}
