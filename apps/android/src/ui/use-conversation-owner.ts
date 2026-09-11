import { useId, useLayoutEffect } from "react";

import { useConversationRef, useConversationState } from "./use-conversation-scope";

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
  const tokenRef = useConversationRef<ConversationOwnerToken | null>(scope, () => null);
  useLayoutEffect(() => {
    const token = ownerRegistry.acquire(scope, ownerId);
    tokenRef.current = token;
    return () => {
      ownerRegistry.release(token);
    };
  }, [ownerId, scope, tokenRef]);
  // These capabilities retain this activation's token. Reading the latest
  // token through useEvent would let an old request mutate a different chat.
  const [owner] = useConversationState(scope, () => ({
    isCurrent: () => tokenRef.current !== null && ownerRegistry.isCurrent(tokenRef.current),
    hasReplacement: () => tokenRef.current !== null && ownerRegistry.hasReplacement(tokenRef.current),
  }));
  return owner;
}
