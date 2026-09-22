#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const androidDirectory = path.resolve(scriptDirectory, "..");
const baselinePath = path.join(androidDirectory, "oxlint.v1.baseline.json");
const oxlintPath = path.join(androidDirectory, "node_modules", ".bin", "oxlint");
const updateBaseline = process.argv.includes("--update-baseline");
const UNUSED_DISABLE_CODE = "oxlint(unused-disable-directive)";

function readDiagnostic(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.filename !== "string" ||
    typeof value.message !== "string"
  ) {
    throw new TypeError("Oxlint returned an invalid diagnostic.");
  }

  if (typeof value.code === "string") {
    return { code: value.code, filename: value.filename };
  }

  if (
    value.message === "Unused eslint-disable directive (no problems were reported)." ||
    value.message === "Unused oxlint-disable directive (no problems were reported)."
  ) {
    return { code: UNUSED_DISABLE_CODE, filename: value.filename };
  }

  throw new TypeError("Oxlint returned a diagnostic without a rule code.");
}

const result = spawnSync(
  oxlintPath,
  [
    "--config",
    "oxlint.v1.config.mjs",
    "--tsconfig",
    "tsconfig.json",
    "--type-aware",
    "--type-check",
    "--deny-warnings",
    "--report-unused-disable-directives",
    "--format",
    "json",
    "--no-error-on-unmatched-pattern",
    "app/legacy.tsx",
    "app/(workspace)",
    "src",
  ],
  {
    cwd: androidDirectory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (result.error !== undefined) {
  throw result.error;
}

if (result.signal !== null) {
  throw new Error(`Oxlint terminated with signal ${result.signal}`);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch (error) {
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  throw new Error("Oxlint did not return a JSON report.", { cause: error });
}

if (!Array.isArray(report.diagnostics)) {
  throw new TypeError("Oxlint JSON report does not contain a diagnostics array.");
}

const current = new Map();
for (const value of report.diagnostics) {
  const diagnostic = readDiagnostic(value);
  const key = `${diagnostic.filename}\0${diagnostic.code}`;
  current.set(key, (current.get(key) ?? 0) + 1);
}

const manifest = Object.fromEntries(
  [...current.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => [key, count]),
);

if (updateBaseline) {
  await writeFile(
    baselinePath,
    `${JSON.stringify({ version: 1, violations: manifest }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`Recorded ${report.diagnostics.length} V1 hygiene violations.\n`);
  process.exitCode = 0;
} else {
  const baselineDocument = JSON.parse(await readFile(baselinePath, "utf8"));
  if (
    typeof baselineDocument !== "object" ||
    baselineDocument === null ||
    baselineDocument.version !== 1 ||
    typeof baselineDocument.violations !== "object" ||
    baselineDocument.violations === null ||
    Array.isArray(baselineDocument.violations)
  ) {
    throw new TypeError("The V1 hygiene baseline has an invalid shape.");
  }

  const baselineEntries = Object.entries(baselineDocument.violations);
  if (
    baselineEntries.some(
      ([, count]) => typeof count !== "number" || !Number.isSafeInteger(count) || count < 0,
    )
  ) {
    throw new TypeError("The V1 hygiene baseline contains an invalid violation count.");
  }

  const regressions = [];
  for (const [key, count] of current) {
    const allowedCount = baselineDocument.violations[key];
    if (typeof allowedCount !== "number" || count > allowedCount) {
      const separator = key.indexOf("\0");
      regressions.push({
        count,
        filename: key.slice(0, separator),
        previousCount: typeof allowedCount === "number" ? allowedCount : 0,
        rule: key.slice(separator + 1),
      });
    }
  }

  if (regressions.length > 0) {
    regressions.sort((left, right) =>
      `${left.filename}\0${left.rule}`.localeCompare(`${right.filename}\0${right.rule}`),
    );
    for (const regression of regressions) {
      process.stderr.write(
        `${regression.filename}: ${regression.rule} increased from ${regression.previousCount} to ${regression.count}\n`,
      );
    }
    process.stderr.write(
      `V1 hygiene introduced ${regressions.length} new file/rule regression groups.\n`,
    );
    process.exitCode = 1;
  } else {
    const baselineCount = baselineEntries.reduce((sum, [, count]) => sum + count, 0);
    process.stdout.write(
      `V1 hygiene: ${report.diagnostics.length} current violations, ${baselineCount} baseline; no regressions.\n`,
    );
  }
}
