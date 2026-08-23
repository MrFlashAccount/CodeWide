import { useEffect } from "react";

import { useEvent } from "../react/useEvent";

/** Runs one disposal boundary with the latest callback when its owner unmounts. */
export function useUnmount(dispose: () => void): void {
  const disposeLatest = useEvent(dispose);
  useEffect(() => () => disposeLatest(), [disposeLatest]);
}
