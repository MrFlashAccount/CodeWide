import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDurableCreateOperationId } from "../../../scripts/android-e2e/faultControl";

const androidRoot = new URL("../", import.meta.url);
const productionRoots = ["app", "src", "android/app/src/main"];
const forbidden = [
  "e2e-command-fault",
  "/internal/e2e/v2-command-fault",
  "nextLiveHeld",
  "nextCommandIntercepted",
];

describe("V2 E2E fault isolation", () => {
  it("keeps the Companion-only fault controller out of Android production sources", () => {
    for (const root of productionRoots) {
      for (const path of sourceFiles(join(androidRoot.pathname, root))) {
        const source = readFileSync(path, "utf8");
        for (const marker of forbidden) expect(source, path).not.toContain(marker);
      }
    }
  });

  it("reads only the content-free post-commit operation marker from Android logcat", () => {
    expect(
      parseDurableCreateOperationId(
        'I/ReactNativeJS: CodeWide Sync V2 durable operation committed {"commandKind":"turn.submit","operationId":"operation-a"}',
      ),
    ).toBe("operation-a");
    expect(
      parseDurableCreateOperationId(
        "I/ReactNativeJS: CodeWide Sync V2 durable operation committed private prompt",
      ),
    ).toBeNull();
  });
});

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if ([".js", ".json", ".kt", ".tsx", ".ts", ".xml"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}
