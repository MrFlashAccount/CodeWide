/* eslint-disable react-hooks/exhaustive-deps, react-hooks/rules-of-hooks, react-hooks/use-memo */
import { useCallback } from "react";
import * as React from "react";

import { useLatest } from "./useLatest";

const noop = (..._args: any[]) => {};
const noopcb = () => noop;
const emptyArray: Readonly<never[]> = [];
const useEffectEvent = "useEffectEvent" in React ? React.useEffectEvent : noopcb;

export function useEvent<T extends (...args: any[]) => any>(cb: T | undefined | null | false): T {
  const ref = useLatest<T | undefined | null | false>(cb);
  const dontCallInRenderGuard = useEffectEvent(noop);
  // @ts-expect-error We know that ref.current is T after the nullish guard.
  return useCallback<T>((...args: Parameters<T>) => {
    dontCallInRenderGuard();

    if (ref.current === null || ref.current === false || ref.current === undefined) {
      return;
    }

    return ref.current(...args);
  }, emptyArray);
}
