import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const nativeRoot = "../android/app/src/main/java/dev/codewide/app/";

it("uses stock RN scroll managers without a custom edge-rendering override", () => {
  const app = readFileSync(new URL(`${nativeRoot}MainApplication.kt`, import.meta.url), "utf8");
  expect(app).not.toContain("ScrollEdgePackage");
});

it("does not opt any application scroll surface into fading-edge compositing", () => {
  const root = new URL("../src/", import.meta.url);
  // This is an application-wide rendering policy, including future scroll hosts.
  for (const path of readdirSync(root, { recursive: true })) {
    if (!/\.tsx?$/.test(path)) continue;
    expect(readFileSync(new URL(path, root), "utf8"), path).not.toContain("fadingEdgeLength");
  }
});
