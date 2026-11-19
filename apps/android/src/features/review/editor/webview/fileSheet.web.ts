const MIN_DRAG_HEIGHT = 56;
const DISMISS_DRAG = 48;
const TAP_SLOP = 8;
const SNAP_DRAG = 32;

/** One dialog element serves as a nonmodal sidebar or a modal bottom sheet. */
export function createFileSheet(
  panel: HTMLDialogElement,
  grip: HTMLButtonElement,
  dismiss: () => void,
): (compact: boolean, open: boolean) => boolean {
  let expanded = false;
  let gesture: { height: number; id: number; y: number } | null = null;
  function snap(tall: boolean) {
    expanded = tall;
    panel.dataset.tall = String(tall);
    grip.setAttribute("aria-label", tall ? "Collapse file picker" : "Expand file picker");
    grip.setAttribute("aria-expanded", String(tall));
    panel.style.removeProperty("height");
  }
  grip.onpointerdown = (event) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    gesture = { height: panel.offsetHeight, id: event.pointerId, y: event.clientY };
    grip.setPointerCapture(event.pointerId);
    panel.dataset.dragging = "true";
  };
  grip.onpointermove = (event) => {
    if (gesture?.id !== event.pointerId) {
      return;
    }
    panel.style.height =
      String(Math.max(MIN_DRAG_HEIGHT, gesture.height + gesture.y - event.clientY)) + "px";
  };
  grip.onpointerup = (event) => {
    if (gesture?.id !== event.pointerId) {
      return;
    }
    const delta = event.clientY - gesture.y;
    gesture = null;
    delete panel.dataset.dragging;
    if (!expanded && delta > DISMISS_DRAG) {
      dismiss();
    } else {
      snap(
        Math.abs(delta) < TAP_SLOP ? !expanded : Math.abs(delta) > SNAP_DRAG ? delta < 0 : expanded,
      );
    }
  };
  grip.onlostpointercapture = () => {
    gesture = null;
    delete panel.dataset.dragging;
    panel.style.removeProperty("height");
  };
  grip.onclick = (event) => {
    if (event.detail === 0) {
      snap(!expanded);
    }
  };
  panel.oncancel = (event) => {
    event.preventDefault();
    dismiss();
  };
  panel.onclick = (event) => {
    if (event.target !== panel || !panel.matches(":modal")) {
      return;
    }
    if (event.clientY < panel.getBoundingClientRect().top) {
      dismiss();
    }
  };
  return (compact: boolean, open: boolean): boolean => {
    const modal = panel.matches(":modal");
    if (panel.open && (!open || compact !== modal)) {
      panel.close();
    }
    if (!open || panel.open) {
      return false;
    }
    snap(false);
    if (compact) {
      panel.showModal();
    } else {
      // Revealing the persistent sidebar must not focus search and open the keyboard.
      panel.open = true;
    }
    return true;
  };
}
