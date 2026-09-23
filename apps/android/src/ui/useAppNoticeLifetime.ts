import { useEffect, useRef } from "react";

const DEFAULT_DURATION_MS = 4000;

/** Pauses a toast lifetime while its stack is expanded or being dragged. */
export function useAppNoticeLifetime({
  duration,
  onExpire,
  paused,
}: {
  readonly duration: number | undefined;
  readonly onExpire: () => void;
  readonly paused: boolean;
}): void {
  const remaining = useRef(duration ?? DEFAULT_DURATION_MS);
  useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) {
      return undefined;
    }
    const started = Date.now();
    const timeout = setTimeout(
      () => {
        onExpire();
      },
      Math.max(0, remaining.current),
    );
    return () => {
      clearTimeout(timeout);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [onExpire, paused]);
}
