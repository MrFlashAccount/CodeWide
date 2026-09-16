import { useConstant } from "./useConstant";
import { useLatest } from "./useLatest";

type EventCallback = (...args: never[]) => unknown;
type OptionalEventCallback<Callback extends EventCallback> = (
  ...args: Parameters<Callback>
) => ReturnType<Callback> | undefined;

/** Returns a stable callback that always invokes the latest supplied implementation. */
export function useEvent<Callback extends EventCallback>(callback: Callback): Callback;
/** Returns a stable optional callback whose absent implementation resolves to `undefined`. */
export function useEvent<Callback extends EventCallback>(
  callback: Callback | undefined | null | false,
): OptionalEventCallback<Callback>;
/** Implements both callback-presence overloads with one stable retained dispatcher. */
export function useEvent<Callback extends EventCallback>(
  callback: Callback | undefined | null | false,
): OptionalEventCallback<Callback> {
  const ref = useLatest(callback);
  return useConstant<OptionalEventCallback<Callback>>(
    () =>
      (...args: Parameters<Callback>): ReturnType<Callback> | undefined => {
        const current = ref.current;
        if (current === null || current === false || current === undefined) {
          return undefined;
        }
        const result: unknown = current(...args);
        // WHY: Parameters and ReturnType come from the same retained callback; TypeScript cannot preserve that relationship through a generic invocation.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return result as ReturnType<Callback>;
      },
  );
}
