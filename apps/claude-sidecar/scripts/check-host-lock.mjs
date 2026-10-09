#!/usr/bin/env node
// Fails (exit 1) when the host install lock drifts from the sidecar's
// single version source, apps/claude-sidecar/package.json: every runtime
// dependency must be pinned to the same exact version in host/package.json
// and resolved to that version in host/package-lock.json, and the host must
// not depend on anything else.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

const source = read("package.json").dependencies ?? {};
const host = read("host/package.json").dependencies ?? {};
const lock = read("host/package-lock.json");
const problems = [];

for (const [name, version] of Object.entries(source)) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) problems.push(`${name}: ${version} is not an exact version in package.json`);
  if (host[name] !== version) problems.push(`${name}: host/package.json has ${host[name] ?? "nothing"}, package.json has ${version}`);
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (locked !== version) problems.push(`${name}: host/package-lock.json resolves ${locked ?? "nothing"}, package.json has ${version}`);
  if (lock.packages?.[""]?.dependencies?.[name] !== version) problems.push(`${name}: host lock root does not pin ${version}`);
}
for (const name of Object.keys(host)) {
  if (!(name in source)) problems.push(`${name}: host/package.json depends on a package the sidecar does not declare`);
}

if (problems.length > 0) {
  process.stderr.write(`claude-sidecar host lock drift:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("claude-sidecar host lock matches package.json\n");
