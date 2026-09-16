import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const androidRoot = fileURLToPath(new URL("..", import.meta.url));

interface OxlintDiagnostic {
  readonly code: string;
  readonly message: string;
}

/** Runs the production V1 OXLint configuration against an isolated source fixture. */
export function lintV1Source(
  source: string,
  fileName = "Fixture.tsx",
): readonly OxlintDiagnostic[] {
  const fixtureDirectory = mkdtempSync(join(androidRoot, "src/features/.oxlint-fixture-"));
  const fixturePath = join(fixtureDirectory, fileName);
  writeFileSync(fixturePath, source);
  try {
    const result = spawnSync(
      join(androidRoot, "node_modules/.bin/oxlint"),
      [
        "--config",
        join(androidRoot, "oxlint.v1.config.mjs"),
        "--format",
        "json",
        relative(androidRoot, fixturePath),
      ],
      { cwd: androidRoot, encoding: "utf8" },
    );
    if (result.error !== undefined) {
      throw result.error;
    }
    const report = JSON.parse(result.stdout) as {
      readonly diagnostics: readonly OxlintDiagnostic[];
    };
    return report.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
    }));
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
}
