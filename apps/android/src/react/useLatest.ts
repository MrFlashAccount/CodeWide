/* eslint-disable react-hooks/refs */
import { useRef, type RefObject } from "react";

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef<T>(value);
  ref.current = value;
  return ref;
}
