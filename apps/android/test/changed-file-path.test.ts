import { describe, expect, it } from "vitest";

import { changedFileDisplayPath } from "../src/rendering/changed-file-path";

describe("changedFileDisplayPath", () => {
  it("makes descendants relative to the thread cwd", () => {
    expect(changedFileDisplayPath("/workspace/apps/android/src/App.tsx", "/workspace"))
      .toBe("apps/android/src/App.tsx");
  });

  it("does not rewrite a path outside the cwd boundary", () => {
    expect(changedFileDisplayPath("/workspace-old/App.tsx", "/workspace"))
      .toBe("/workspace-old/App.tsx");
  });

  it("normalizes Windows separators and keeps the basename", () => {
    expect(changedFileDisplayPath("C:\\repo\\src\\App.tsx", "C:\\repo"))
      .toBe("src/App.tsx");
  });

  it("compacts the middle while preserving the first folder and filename", () => {
    expect(changedFileDisplayPath(
      "/workspace/apps/android/src/rendering/deep/components/RichMarkdown.tsx",
      "/workspace",
      36,
    )).toBe("apps/…/components/RichMarkdown.tsx");
  });

  it("compares Windows roots case-insensitively", () => {
    expect(changedFileDisplayPath("C:\\Repo\\src\\App.tsx", "c:\\repo"))
      .toBe("src/App.tsx");
  });

  it("never hides the filename merely to satisfy the visual hint", () => {
    expect(changedFileDisplayPath("src/deep/ExtraordinarilyLongGeneratedFilename.tsx", "/repo", 20))
      .toBe("src/…/ExtraordinarilyLongGeneratedFilename.tsx");
  });
});
