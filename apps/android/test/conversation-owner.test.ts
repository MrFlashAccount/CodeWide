import { describe, expect, it } from "vitest";

import { createConversationOwnerRegistry } from "../src/ui/use-conversation-owner";

describe("conversation async ownership", () => {
  it("remembers a superseding generation after the replacement unmounts", () => {
    const registry = createConversationOwnerRegistry();
    const first = registry.acquire("thread-a", "a-1");
    registry.release(first);
    const second = registry.acquire("thread-a", "a-2");
    registry.release(second);

    expect(registry.isCurrent(first)).toBe(false);
    expect(registry.hasReplacement(first)).toBe(true);
    expect(registry.hasReplacement(second)).toBe(false);
  });

  it("distinguishes remounts even when React reuses the same useId value", () => {
    const registry = createConversationOwnerRegistry();
    const first = registry.acquire("thread-a", "react-id");
    const second = registry.acquire("thread-a", "react-id");

    expect(registry.isCurrent(first)).toBe(false);
    expect(registry.isCurrent(second)).toBe(true);
    registry.release(first);
    expect(registry.isCurrent(second)).toBe(true);
  });

  it("keeps unrelated thread ownership independent", () => {
    const registry = createConversationOwnerRegistry();
    const first = registry.acquire("thread-a", "a-1");
    const other = registry.acquire("thread-b", "b-1");

    expect(registry.isCurrent(first)).toBe(true);
    expect(registry.isCurrent(other)).toBe(true);
    expect(registry.hasReplacement(first)).toBe(false);
  });
});
