import { useId, useLayoutEffect, useRef } from "react";

import { useEvent } from "../react/useEvent";

export type ConversationOwnerToken = { scope: string; ownerId: string; generation: number };

export function createConversationOwnerRegistry() {
  const mountedOwners = new Map<string, ConversationOwnerToken>();
  const latestOwnerGeneration = new Map<string, number>();
  return {
    acquire(scope: string, ownerId: string): ConversationOwnerToken {
      const token = { scope, ownerId, generation: (latestOwnerGeneration.get(scope) ?? 0) + 1 };
      latestOwnerGeneration.set(scope, token.generation);
      mountedOwners.set(scope, token);
      return token;
    },
    release(token: ConversationOwnerToken): void {
      if (mountedOwners.get(token.scope) === token) mountedOwners.delete(token.scope);
    },
    isCurrent(token: ConversationOwnerToken): boolean {
      return mountedOwners.get(token.scope) === token;
    },
    hasReplacement(token: ConversationOwnerToken): boolean {
      return (latestOwnerGeneration.get(token.scope) ?? 0) > token.generation;
    },
  };
}

const ownerRegistry = createConversationOwnerRegistry();

export type ConversationOwner = {
  isCurrent(): boolean;
  hasReplacement(): boolean;
};

/**
 * Gives async work an exact mounted-generation owner. Scope strings alone are
 * insufficient because a conversation can unmount and later remount with the
 * same connection/thread identity while an old Promise is still pending.
 */
export function useConversationOwner(scope: string): ConversationOwner {
  const ownerId = useId();
  const tokenRef = useRef<ConversationOwnerToken | null>(null);
  useLayoutEffect(() => {
    const token = ownerRegistry.acquire(scope, ownerId);
    tokenRef.current = token;
    return () => {
      ownerRegistry.release(token);
    };
  }, [ownerId, scope]);
  const isCurrent = useEvent(() => tokenRef.current !== null && ownerRegistry.isCurrent(tokenRef.current));
  const hasReplacement = useEvent(() => tokenRef.current !== null && ownerRegistry.hasReplacement(tokenRef.current));
  return {
    isCurrent,
    hasReplacement,
  };
}
