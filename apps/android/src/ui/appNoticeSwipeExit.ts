const SWIPE_THRESHOLD = 45;
const SWIPE_VELOCITY = 300;

/** A gesture either settles or exits through exactly one supported direction. */
type NoticeSwipeExit =
  | { readonly direction: -1 | 1; readonly kind: "horizontal" }
  | { readonly kind: "up" }
  | { readonly kind: "none" };

// Define the dependency first: Worklets captures it when constructing the resolver below.
function resolveHorizontalSwipeExit(x: number, velocityX: number): NoticeSwipeExit {
  "worklet";
  if (Math.abs(x) < SWIPE_THRESHOLD && Math.abs(velocityX) < SWIPE_VELOCITY) {
    return { kind: "none" };
  }
  const direction = (x === 0 ? velocityX : x) < 0 ? -1 : 1;
  return { direction, kind: "horizontal" };
}

/** Resolves toast dismissal, including its horizontal helper, entirely on the UI runtime. */
export function resolveNoticeSwipeExit(motion: {
  readonly velocityX: number;
  readonly velocityY: number;
  readonly x: number;
  readonly y: number;
}): NoticeSwipeExit {
  "worklet";
  if (Math.abs(motion.x) > Math.abs(motion.y)) {
    return resolveHorizontalSwipeExit(motion.x, motion.velocityX);
  }
  if (
    motion.y < 0 &&
    (Math.abs(motion.y) >= SWIPE_THRESHOLD || motion.velocityY <= -SWIPE_VELOCITY)
  ) {
    return { kind: "up" };
  }
  return { kind: "none" };
}
