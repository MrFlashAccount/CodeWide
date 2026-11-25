import { useEffectEvent } from "react";
import { useConstant } from "./useConstant";

type EventCallback = (...args: never[]) => unknown;
type OptionalEventCallback<Callback extends EventCallback> = (
  ...args: Parameters<Callback>
) => ReturnType<Callback> | undefined;

/** Returns a stable callback for use outside render with the latest committed implementation. */
export function useEvent<Callback extends EventCallback>(callback: Callback): Callback;
/** Returns a stable optional callback whose absent implementation resolves to `undefined`. */
export function useEvent<Callback extends EventCallback>(
  callback: Callback | undefined | null | false,
): OptionalEventCallback<Callback>;
/** Implements both callback-presence overloads with one stable retained dispatcher. */
export function useEvent<Args extends unknown[], Result>(
  callback: ((...args: Args) => Result) | undefined | null | false,
): (...args: Args) => Result | undefined {
  const dispatch = useEffectEvent((...args: Args) =>
    typeof callback === "function" ? callback(...args) : undefined,
  );
  return useConstant(
    () =>
      (...args: Args) =>
        // WHY: Our pinned React 19.2 renderers guard every call and publish the implementation at commit.
        // This adapter deliberately also serves UI events; its renderer contract is covered by v1-use-event.
        // oxlint-disable-next-line react-hooks-js/rules-of-hooks
        dispatch(...args),
  );
}
