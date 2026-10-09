#!/usr/bin/env node
// Fails (exit 1) when the install lock drifts from the host's single version
// source, crates/agent-provider-claude/host/package.json: every runtime
// dependency must be pinned to the same exact version in install/package.json
// and resolved to that version in install/package-lock.json, and the install
// must not depend on anything else.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;

const source = read("package.json").dependencies ?? {};
const install = read("install/package.json").dependencies ?? {};
const lock = read("install/package-lock.json");
const problems = [];

for (const [name, version] of Object.entries(source)) {
  if (!EXACT_VERSION.test(version)) {
    problems.push(`${name}: ${version} is not an exact version in package.json`);
  }
  if (install[name] !== version) {
    problems.push(
      `${name}: install/package.json has ${install[name] ?? "nothing"}, package.json has ${version}`,
    );
  }
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (locked !== version) {
    problems.push(
      `${name}: install/package-lock.json resolves ${locked ?? "nothing"}, package.json has ${version}`,
    );
  }
  if (lock.packages?.[""]?.dependencies?.[name] !== version) {
    problems.push(`${name}: install lock root does not pin ${version}`);
  }
}
for (const name of Object.keys(install)) {
  if (!Object.hasOwn(source, name)) {
    problems.push(`${name}: install/package.json depends on a package the host does not declare`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `claude agent host install lock drift:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("claude agent host install lock matches package.json\n");
}
