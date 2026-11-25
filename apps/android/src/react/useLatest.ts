import { useLayoutEffect, useRef, type RefObject } from "react";

/** Publishes committed values to retained readers without exposing suspended renders. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef<T>(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
