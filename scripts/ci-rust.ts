#!/usr/bin/env node

/**
 * Checks and tests every affected Rust project with one cargo invocation per
 * step. Cargo resolves dependency features for the packages one invocation
 * selects, so separate `cargo … -p <package>` runs compile shared
 * dependencies once per feature set; one invocation over all affected
 * packages compiles each dependency once per profile.
 *
 * The affected range is Nx's (`NX_BASE`/`NX_HEAD`, as `nx affected` uses);
 * `--all` selects every Rust project.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nxCli = resolve(repoRoot, "node_modules/.bin/nx");
const RUST_PROJECTS = "tag:language:rust";

/** The cargo package a Rust project's `check` command lints. */
export function cargoPackageOf(command: string): string | undefined {
  return /\bcargo clippy\b.*?\s-p\s+(\S+)/u.exec(command)?.[1];
}

/** The cargo arguments selecting `packages`, in a stable order. */
export function packageArguments(packages: readonly string[]): readonly string[] {
  return [...new Set(packages)].sort().flatMap((name) => ["-p", name]);
}

function run(command: string, args: readonly string[], input?: string): string {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  return result.stdout;
}

function stringList(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Nx returned an invalid ${what}`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rustProjects(all: boolean): readonly string[] {
  const args = ["show", "projects", "--projects", RUST_PROJECTS, "--withTarget=check", "--json"];
  return stringList(JSON.parse(run(nxCli, all ? args : [...args, "--affected"])), "project list");
}

function checkCommand(project: string): string {
  const value: unknown = JSON.parse(run(nxCli, ["show", "project", project, "--json"]));
  const targets = isRecord(value) ? value.targets : undefined;
  const check = isRecord(targets) ? targets.check : undefined;
  const options = isRecord(check) ? check.options : undefined;
  const command = isRecord(options) ? options.command : undefined;
  if (typeof command !== "string") throw new Error(`${project} has no check command`);
  return command;
}

function cargo(args: readonly string[]): void {
  console.log(`[ci-rust] cargo ${args.join(" ")}`);
  const result = spawnSync("cargo", args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main(): void {
  const projects = rustProjects(process.argv.includes("--all"));
  const packages = projects.map((project) => {
    const name = cargoPackageOf(checkCommand(project));
    if (name === undefined) throw new Error(`${project} has no cargo package in its check command`);
    return name;
  });
  if (packages.length === 0) {
    console.log("[ci-rust] no affected Rust project");
    return;
  }
  const selected = packageArguments(packages);
  cargo(["clippy", "--locked", ...selected, "--all-targets", "--all-features", "--", "-D", "warnings"]);
  cargo(["test", "--locked", ...selected, "--all-features"]);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
