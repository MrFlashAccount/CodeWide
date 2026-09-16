import { useLayoutEffect, useRef, type RefObject } from "react";

/** Exposes the latest render value through a stable ref identity. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef<T>(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
