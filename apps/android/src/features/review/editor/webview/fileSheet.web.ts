import { FileSheetMotion, SHORT_SHEET, TALL_SHEET, type SheetStop } from "./fileSheetMotion.web";

const TAP_SLOP = 8;
const DISMISS_DRAG = 48;
const SNAP_DRAG = 32;
const PROJECTION_MS = 120;
const SAMPLE_WINDOW_MS = 90;
const MS_PER_SECOND = 1000;

type Sample = { readonly time: number; readonly y: number };
type Drag = {
  readonly id: number;
  moved: boolean;
  readonly samples: Sample[];
  readonly shown: number;
  readonly startY: number;
};

function sample(drag: Drag, event: PointerEvent): number {
  const time = event.timeStamp;
  if (Math.abs(event.clientY - drag.startY) >= TAP_SLOP) {
    drag.moved = true;
  }
  let first = drag.samples.at(0);
  while (first !== undefined && first.time < time - SAMPLE_WINDOW_MS) {
    drag.samples.shift();
    first = drag.samples.at(0);
  }
  drag.samples.push({ time, y: event.clientY });
  return first === undefined || first.time === time
    ? 0
    : (event.clientY - first.y) / (time - first.time);
}

function releaseStop(start: SheetStop, shown: number, projected: number): SheetStop {
  if (projected > DISMISS_DRAG && (start === SHORT_SHEET || shown < SHORT_SHEET)) {
    return 0;
  }
  if (Math.abs(projected) > SNAP_DRAG) {
    return projected < 0 ? TALL_SHEET : SHORT_SHEET;
  }
  return start;
}

/** One dialog element serves as a nonmodal sidebar or a modal bottom sheet. */
export function createFileSheet(
  panel: HTMLDialogElement,
  grip: HTMLButtonElement,
  dismiss: () => void,
): (compact: boolean, open: boolean) => boolean {
  const motion = new FileSheetMotion(panel);
  let drag: Drag | null = null;
  let compact = false;
  let open = false;

  function settle(stop: SheetStop, velocity?: number): void {
    drag = null;
    const tall = stop === TALL_SHEET;
    grip.setAttribute("aria-label", tall ? "Collapse file picker" : "Expand file picker");
    grip.setAttribute("aria-expanded", String(tall));
    motion.settle(stop, velocity);
  }
  function requestClose(velocity?: number): void {
    if (motion.stop !== 0) {
      settle(0, velocity);
      dismiss();
    }
  }
  function toggle(): void {
    settle(motion.stop === SHORT_SHEET ? TALL_SHEET : SHORT_SHEET);
  }
  grip.onpointerdown = (event) => {
    if (!event.isPrimary || event.button !== 0 || motion.stop === 0) {
      return;
    }
    drag = {
      id: event.pointerId,
      moved: false,
      samples: [],
      shown: motion.grab(),
      startY: event.clientY,
    };
    sample(drag, event);
    grip.setPointerCapture(event.pointerId);
  };
  grip.onpointermove = (event) => {
    if (drag?.id === event.pointerId) {
      sample(drag, event);
      motion.drag(
        drag.shown +
          (drag.startY - event.clientY) / Math.max(1, document.documentElement.clientHeight),
      );
    }
  };
  grip.onpointerup = (event) => {
    if (drag?.id !== event.pointerId) {
      return;
    }
    const delta = event.clientY - drag.startY;
    const speed = sample(drag, event);
    const projected = delta + speed * PROJECTION_MS;
    const height = Math.max(1, document.documentElement.clientHeight);
    const shown = drag.shown - delta / height;
    const velocity = (-speed * MS_PER_SECOND) / height;
    motion.drag(shown);
    if (!drag.moved) {
      toggle();
      return;
    }
    const target = releaseStop(motion.stop, shown, projected);
    if (target === 0) {
      requestClose(velocity);
    } else {
      settle(target, velocity);
    }
  };
  grip.onlostpointercapture = (event) => {
    // Normal release already handed the live transform to the spring.
    if (drag?.id === event.pointerId) {
      settle(motion.stop);
    }
  };
  grip.onclick = (event) => {
    if (event.detail === 0 && motion.stop !== 0) {
      toggle();
    }
  };
  panel.oncancel = (event) => {
    event.preventDefault();
    requestClose();
  };
  panel.onclick = (event) => {
    if (
      event.target === panel &&
      panel.matches(":modal") &&
      event.clientY < panel.getBoundingClientRect().top
    ) {
      requestClose();
    }
  };
  function hideModal(): void {
    if (!panel.matches(":modal")) {
      panel.close();
    } else if (motion.stop !== 0) {
      settle(0);
    }
  }
  return (nextCompact, nextOpen): boolean => {
    if (nextCompact === compact && nextOpen === open) {
      return false;
    }
    const wasModal = panel.matches(":modal");
    compact = nextCompact;
    open = nextOpen;
    if (!compact) {
      drag = null;
      if (wasModal) {
        motion.reset();
      }
      panel.open = open;
      return open;
    }
    if (!open) {
      hideModal();
      return false;
    }
    if (!wasModal) {
      panel.close();
      panel.showModal();
      // Native opens the picker outside the DOM. Start focus on the dialog itself
      // rather than giving the grip a keyboard ring or raising the search keyboard.
      panel.focus({ preventScroll: true });
    }
    settle(SHORT_SHEET);
    return true;
  };
}
