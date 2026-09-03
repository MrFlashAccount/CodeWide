import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const nativeHostPath = fileURLToPath(
  new URL("../src/presentation/nativeCodeBlockHost.tsx", import.meta.url),
);
const nativeRegistrationPattern =
  /requireNativeComponent(?:<[^>]+>)?\s*\(\s*["']CodexNativeCodeBlock["']\s*\)/;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (
      (extname(entry.name) === ".ts" || extname(entry.name) === ".tsx") &&
      !entry.name.includes(".test.")
    ) {
      files.push(path);
    }
  }
  return files;
}

describe("V1/V2 native code block registration", () => {
  it("has exactly one production JS registration site while V1 and V2 coexist", () => {
    const registrationFiles = sourceFiles(sourceRoot).filter((path) =>
      nativeRegistrationPattern.test(readFileSync(path, "utf8")),
    );

    expect(registrationFiles).toEqual([nativeHostPath]);
  });

  it("routes both generation-specific renderers through the shared native host", () => {
    const legacyRenderer = readFileSync(
      new URL("../src/rendering/NativeCodeBlock.tsx", import.meta.url),
      "utf8",
    );
    const v2Renderer = readFileSync(
      new URL("../src/v2/rendering/NativeCodeBlock.tsx", import.meta.url),
      "utf8",
    );

    expect(legacyRenderer).toContain(
      'import { NativeCodeBlockHost } from "../presentation/nativeCodeBlockHost";',
    );
    expect(v2Renderer).toContain(
      'import { NativeCodeBlockHost } from "../../presentation/nativeCodeBlockHost";',
    );
    expect(legacyRenderer).not.toContain("requireNativeComponent");
    expect(v2Renderer).not.toContain("requireNativeComponent");
  });
});
