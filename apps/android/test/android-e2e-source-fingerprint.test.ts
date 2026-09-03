import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCommand } from "../../../scripts/android-e2e/process.ts";
import {
  computeSourceFingerprint,
  requireStableSourceFingerprint,
} from "../../../scripts/android-e2e/sourceFingerprint.ts";

describe("Android E2E source fingerprint", () => {
  it("covers tracked changes and sorted untracked bytes while excluding ignored artifacts", async () => {
    const repository = await createRepository();
    try {
      const baseline = await computeSourceFingerprint(repository);

      await mkdir(path.join(repository, "test-results", "android-e2e"), { recursive: true });
      await writeFile(path.join(repository, "test-results", "android-e2e", "evidence.json"), "old");
      expect(await computeSourceFingerprint(repository)).toBe(baseline);

      await writeFile(path.join(repository, "tracked.ts"), "export const tracked = 2;\n");
      expect(await computeSourceFingerprint(repository)).not.toBe(baseline);
      await writeFile(path.join(repository, "tracked.ts"), "export const tracked = 1;\n");
      expect(await computeSourceFingerprint(repository)).toBe(baseline);

      await writeFile(path.join(repository, "z-untracked.ts"), "z-one\n");
      await writeFile(path.join(repository, "a-untracked.ts"), "a-one\n");
      const firstUntracked = await computeSourceFingerprint(repository);
      await unlink(path.join(repository, "z-untracked.ts"));
      await unlink(path.join(repository, "a-untracked.ts"));
      await writeFile(path.join(repository, "a-untracked.ts"), "a-one\n");
      await writeFile(path.join(repository, "z-untracked.ts"), "z-one\n");
      expect(await computeSourceFingerprint(repository)).toBe(firstUntracked);

      await writeFile(path.join(repository, "a-untracked.ts"), "a-two\n");
      expect(await computeSourceFingerprint(repository)).not.toBe(firstUntracked);
    } finally {
      await removeTemporaryRepository(repository);
    }
  });

  it("rejects source changes between the pre-build and post-cleanup fingerprints", () => {
    expect(requireStableSourceFingerprint("sha256:stable", "sha256:stable")).toBe("sha256:stable");
    expect(() => requireStableSourceFingerprint("sha256:before", "sha256:after")).toThrow(
      "Repository source changed while Android E2E was running",
    );
  });
});

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(os.tmpdir(), "codewide-fingerprint-test-"));
  await runCommand("git", ["init", "--quiet"], { cwd: repository });
  await runCommand("git", ["config", "user.email", "e2e@example.invalid"], { cwd: repository });
  await runCommand("git", ["config", "user.name", "CodeWide E2E"], { cwd: repository });
  await writeFile(path.join(repository, ".gitignore"), "test-results/\n");
  await writeFile(path.join(repository, "tracked.ts"), "export const tracked = 1;\n");
  await runCommand("git", ["add", ".gitignore", "tracked.ts"], { cwd: repository });
  await runCommand("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repository });
  return repository;
}

async function removeTemporaryRepository(repository: string): Promise<void> {
  const expectedPrefix = path.join(os.tmpdir(), "codewide-fingerprint-test-");
  if (!repository.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected fingerprint fixture: ${repository}`);
  }
  await rm(repository, { recursive: true, force: true });
}
