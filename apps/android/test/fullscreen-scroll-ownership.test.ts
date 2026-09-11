import { describe, expect, it } from "vitest";
import { createFullscreenScrollOwnership } from "../src/ui/fullscreen-scroll-ownership";

describe("fullscreen scroll ownership", () => {
  it("keeps the chat covered until the last nested overlay closes", () => {
    const changes: boolean[] = [];
    const owner = createFullscreenScrollOwnership((covered) => changes.push(covered));
    owner.willOpen("files");
    owner.willOpen("preview");
    owner.willOpen("preview");
    owner.didClose("files");
    owner.didClose("unknown");
    expect(owner.isCovered()).toBe(true);
    expect(changes).toEqual([true]);
    owner.didClose("preview");
    expect(owner.isCovered()).toBe(false);
    expect(changes).toEqual([true, false]);
    owner.didClose("preview");
    owner.willOpen("terminal");
    expect(changes).toEqual([true, false, true]);
  });
});
