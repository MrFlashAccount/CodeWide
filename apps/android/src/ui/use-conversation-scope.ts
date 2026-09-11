import { useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Reset chat-local UI state before commit without remounting its native shell.
 * A callback retained by the previous chat cannot update its replacement. */
export function useConversationState<Value>(scope: string, initialize: () => Value): readonly [Value, Dispatch<SetStateAction<Value>>] {
  const [stored, setStored] = useState(() => ({ scope, owner: {}, value: initialize() }));
  let current = stored;
  if (stored.scope !== scope) {
    current = { scope, owner: {}, value: initialize() };
    setStored(current);
  }
  const owner = current.owner;
  const update: Dispatch<SetStateAction<Value>> = (action) => {
    setStored((previous) => {
      if (previous.owner !== owner) return previous;
      const value = typeof action === "function"
        // WHY: React's SetStateAction deliberately includes a callable Value;
        // its function branch follows the same updater contract as useState.
        ? (action as (previous: Value) => Value)(previous.value)
        : action;
      return Object.is(value, previous.value) ? previous : { ...previous, value };
    });
  };
  return [current.value, update];
}

/** Mutable runtime handles belong to one chat activation, not the shared shell. */
export function useConversationRef<Value>(scope: string, initialize: () => Value): { current: Value } {
  const [referenceRef] = useConversationState(scope, () => ({ current: initialize() }));
  return referenceRef;
}

/** Dispose the outgoing chat's latest committed callbacks, not the new chat's. */
export function useConversationCleanup(scope: string, dispose: () => void): void {
  const referenceRef = useConversationRef(scope, () => dispose);
  useLayoutEffect(() => {
    referenceRef.current = dispose;
  });
  useLayoutEffect(() => () => referenceRef.current(), [referenceRef]);
}
