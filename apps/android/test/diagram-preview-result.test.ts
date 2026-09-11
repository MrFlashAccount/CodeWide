import { describe, expect, it } from "vitest";

import { parseDiagramPreviewResult } from "../src/rendering/diagram-preview-result";

describe("diagram preview result", () => {
  it("preserves a Mermaid source error for the inline error surface", () => {
    expect(parseDiagramPreviewResult(JSON.stringify({
      type: "error",
      requestId: "9",
      message: "Parse error on line 9",
    }))).toEqual({ status: "error", message: "Parse error on line 9" });
  });

  it("adapts a successful renderer response to a ready preview", () => {
    expect(parseDiagramPreviewResult(JSON.stringify({
      type: "preview",
      requestId: "10",
      uri: "file:///data/user/0/dev.codewide.app/cache/diagram-previews/example.png",
      width: 10,
      height: 20,
    }))).toEqual({
      status: "ready",
      preview: {
        uri: "file:///data/user/0/dev.codewide.app/cache/diagram-previews/example.png",
        width: 10,
        height: 20,
      },
    });
  });

  it("rejects malformed renderer failures instead of hiding the protocol error", () => {
    expect(() => parseDiagramPreviewResult(JSON.stringify({ type: "error", message: "" })))
      .toThrow("Invalid diagram renderer error");
  });
});
