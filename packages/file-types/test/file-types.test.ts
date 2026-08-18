import { describe, expect, it } from "vitest";

import { fileBasename, fileExtension, fileMediaKind, isHtmlFile, isKnownCodeOrTextFile, isMarkdownFile } from "../src/index.js";

describe("file type registry", () => {
  it("recognizes language extensions and special source filenames", () => {
    expect(isKnownCodeOrTextFile("/repo/src/component.svelte")).toBe(true);
    expect(isKnownCodeOrTextFile("/repo/Dockerfile")).toBe(true);
    expect(isKnownCodeOrTextFile("/repo/CMakeLists.txt")).toBe(true);
    expect(isKnownCodeOrTextFile("/repo/.gitignore")).toBe(true);
    expect(isKnownCodeOrTextFile("/repo/archive.zip")).toBe(false);
    expect(isKnownCodeOrTextFile("/repo/screenshot.png")).toBe(false);
    expect(isKnownCodeOrTextFile("/repo/module.wasm")).toBe(false);
  });

  it("normalizes URL suffixes and case", () => {
    expect(fileBasename("/repo/Screen.TSX?raw=1#L2")).toBe("screen.tsx");
    expect(fileExtension("/repo/Screen.TSX?raw=1#L2")).toBe("tsx");
  });

  it("classifies UI-specific document and media surfaces once", () => {
    expect(isMarkdownFile("README.MD#intro")).toBe(true);
    expect(isHtmlFile("preview/index.xhtml?raw=1")).toBe(true);
    expect(fileMediaKind("capture.HEIF")).toBe("image");
    expect(fileMediaKind("recording.webm")).toBe("audio");
    expect(fileMediaKind("opaque", "image/png; charset=binary")).toBe("image");
    expect(fileMediaKind("archive.zip")).toBeNull();
  });
});
