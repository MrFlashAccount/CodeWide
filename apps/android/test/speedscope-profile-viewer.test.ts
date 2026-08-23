import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewer = readFileSync(new URL("../src/ui/SpeedscopeProfileViewer.native.tsx", import.meta.url), "utf8");
const syncScript = readFileSync(new URL("../scripts/sync-speedscope-asset.mjs", import.meta.url), "utf8");

describe("bundled Speedscope viewer", () => {
  it("loads the upstream viewer locally and passes the profile through its loader API", () => {
    expect(viewer).toContain("file:///android_asset/speedscope/index.html");
    expect(viewer).toContain("window.speedscope.loadFileFromBase64");
    expect(viewer).toContain('args[0] === "Failed to load format"');
    expect(viewer).toContain('document.body?.innerText.includes("Something went wrong")');
    expect(viewer).toContain('document.title.endsWith(" - speedscope")');
    expect(viewer).not.toContain("https://www.speedscope.app");
    expect(syncScript).toContain('require.resolve("speedscope/package.json")');
    expect(syncScript).toContain('path.join(speedscopeRoot, "dist/release")');
  });
});
