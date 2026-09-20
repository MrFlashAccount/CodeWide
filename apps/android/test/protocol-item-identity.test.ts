import { describe, expect, it } from "vitest";

import {
  nextFileChangeItemKey,
  toolRichItemIdentity,
} from "../src/features/conversation/protocol/protocolItemIdentity";

describe("streaming protocol item identity", () => {
  it("does not couple a file row key to its mutable diff body", () => {
    const before = nextFileChangeItemKey(new Map(), "src/app.ts");
    const after = nextFileChangeItemKey(new Map(), "src/app.ts");

    expect(after).toBe(before);
  });

  it("does not remount an id-less text result when its body grows", () => {
    expect(toolRichItemIdentity({ type: "text", text: "partial" }, 2)).toBe(
      toolRichItemIdentity({ type: "text", text: "partial result" }, 2),
    );
  });

  it("prefers protocol identity over position", () => {
    expect(toolRichItemIdentity({ id: "result-1", type: "text", text: "first" }, 0)).toBe(
      toolRichItemIdentity({ id: "result-1", type: "text", text: "updated" }, 3),
    );
  });
});
