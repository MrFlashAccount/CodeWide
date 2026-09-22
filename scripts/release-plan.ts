#!/usr/bin/env node

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type ReleaseMetadata = {
  readonly id: string;
  readonly runner: string;
  readonly tagPrefix: string;
  readonly baselineVersion: string;
  readonly order: number;
};

type PlannedTarget = ReleaseMetadata & {
  readonly project: string;
  readonly command: string;
};

type ReleasePlan = {
  readonly changedFiles: readonly string[];
  readonly affectedProjects: readonly string[];
  readonly targets: readonly PlannedTarget[];
};

type CliOptions = {
  readonly base: string;
  readonly head: string;
  readonly includeWorkingTree: boolean;
  readonly json: boolean;
  readonly assertTarget: string | undefined;
  readonly files: readonly string[] | undefined;
};

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nxCli = resolve(repoRoot, "node_modules/.bin/nx");
const compatibilityValidator = resolve(repoRoot, "scripts/validate-release-compatibility.ts");

export function parseGitNameStatus(output: string): readonly string[] {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const files: string[] = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index++];
    if (status === undefined) break;
    const firstPath = fields[index++];
    if (firstPath === undefined) throw new Error(`Missing path for Git status ${status}`);
    files.push(firstPath);
    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = fields[index++];
      if (secondPath === undefined) throw new Error(`Missing destination path for Git status ${status}`);
      files.push(secondPath);
    }
  }
  return files;
}

function parseArguments(args: readonly string[]): CliOptions {
  let base = process.env.CODEWIDE_RELEASE_BASE ?? "origin/main";
  let head = process.env.CODEWIDE_RELEASE_HEAD ?? "HEAD";
  let includeWorkingTree = false;
  let json = false;
  let assertTarget: string | undefined;
  let files: readonly string[] | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--base") base = requireArgument(args, ++index, argument);
    else if (argument === "--head") head = requireArgument(args, ++index, argument);
    else if (argument === "--include-working-tree") includeWorkingTree = true;
    else if (argument === "--json") json = true;
    else if (argument === "--assert-target") assertTarget = requireArgument(args, ++index, argument);
    else if (argument === "--files") files = requireArgument(args, ++index, argument).split(",");
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return { base, head, includeWorkingTree, json, assertTarget, files };
}

function requireArgument(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function normalizeFiles(files: readonly string[]): readonly string[] {
  const normalized = new Set<string>();
  for (const candidate of files) {
    const file = candidate.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
    if (file.length === 0) continue;
    if (file.startsWith("/") || file === ".." || file.startsWith("../") || file.includes("/../")) {
      throw new Error(`Changed file must be repository-relative: ${candidate}`);
    }
    normalized.add(file);
  }
  return [...normalized].sort();
}

function readChangedFiles(options: CliOptions): readonly string[] {
  if (options.files !== undefined) return normalizeFiles(options.files);
  const files = new Set(
    runGitNameStatus([
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      "--diff-filter=ACDMRTUXB",
      `${options.base}...${options.head}`,
    ]),
  );
  if (options.includeWorkingTree) {
    for (const file of runGitNameStatus([
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      "--diff-filter=ACDMRTUXB",
      options.head,
    ])) files.add(file);
    for (const file of runGit(["ls-files", "--others", "--exclude-standard"])) files.add(file);
  }
  return normalizeFiles([...files]);
}

function readAffectedProjects(changedFiles: readonly string[]): readonly string[] {
  if (changedFiles.length === 0) return [];
  const args = ["show", "projects", "--affected", "--withTarget=release", "--json", "--stdin"];
  const value: unknown = JSON.parse(runNx(args, `${changedFiles.join("\n")}\n`));
  if (!Array.isArray(value) || value.some((project) => typeof project !== "string")) {
    throw new Error("Nx returned an invalid affected-project list");
  }
  return [...value].sort();
}

function isReleaseInput(file: string): boolean {
  if (file.startsWith("docs/") || file.endsWith(".md")) return false;
  if (file.includes("/test/") || file.includes("/tests/")) return false;
  if (file.includes("/src/test/") || file.includes("/src/androidTest/")) return false;
  if (file.includes("/src/testE2e/") || file.includes("/src/e2e/")) return false;
  return !file.includes(".test.") && !file.includes(".spec.") && !file.endsWith("/tests.rs");
}

function readTarget(project: string): PlannedTarget {
  const value: unknown = JSON.parse(runNx(["show", "project", project, "--json"]));
  if (!isRecord(value)) throw new Error(`Nx returned an invalid project configuration for ${project}`);
  const metadata = isRecord(value.metadata) ? value.metadata.codewideRelease : undefined;
  const release = parseReleaseMetadata(metadata, project);
  const targets = value.targets;
  if (!isRecord(targets) || !isRecord(targets.release)) {
    throw new Error(`Nx project ${project} has no release target`);
  }
  const options = targets.release.options;
  if (!isRecord(options) || typeof options.command !== "string" || options.command.length === 0) {
    throw new Error(`Nx project ${project} has no release command`);
  }
  return { project, command: options.command, ...release };
}

function parseReleaseMetadata(value: unknown, project: string): ReleaseMetadata {
  if (!isRecord(value)) throw new Error(`Nx project ${project} has no codewideRelease metadata`);
  return {
    id: parseNonEmptyString(value.id, `${project}.metadata.codewideRelease.id`),
    runner: parseNonEmptyString(value.runner, `${project}.metadata.codewideRelease.runner`),
    tagPrefix: parseNonEmptyString(value.tagPrefix, `${project}.metadata.codewideRelease.tagPrefix`),
    baselineVersion: parseVersion(value.baselineVersion, `${project}.metadata.codewideRelease.baselineVersion`),
    order: parseNonNegativeInteger(value.order, `${project}.metadata.codewideRelease.order`),
  };
}

function parseVersion(value: unknown, field: string): string {
  const version = parseNonEmptyString(value, field);
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`${field} must be MAJOR.MINOR.PATCH`);
  return version;
}

function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runGitNameStatus(args: readonly string[]): readonly string[] {
  return parseGitNameStatus(runCommand("git", args));
}

function runGit(args: readonly string[]): readonly string[] {
  return runCommand("git", args).split("\n").filter((line) => line.length > 0);
}

function runNx(args: readonly string[], input?: string): string {
  return runCommand(nxCli, args, input);
}

function runCommand(command: string, args: readonly string[], input?: string): string {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", shell: false, input });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function formatPlan(plan: ReleasePlan): string {
  const lines = [
    `Changed files: ${plan.changedFiles.length}`,
    `Affected release projects: ${plan.affectedProjects.length === 0 ? "none" : plan.affectedProjects.join(", ")}`,
    `Release targets: ${plan.targets.length === 0 ? "none" : plan.targets.map(({ id }) => id).join(", ")}`,
  ];
  for (const target of plan.targets) lines.push(`- ${target.id} [${target.runner}]: ${target.command}`);
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  runCommand(process.execPath, [compatibilityValidator]);
  const changedFiles = readChangedFiles(options);
  const affectedProjects = readAffectedProjects(changedFiles.filter(isReleaseInput));
  const targets = affectedProjects.map(readTarget).sort((left, right) => left.order - right.order);
  const plan: ReleasePlan = { changedFiles, affectedProjects, targets };
  if (options.assertTarget !== undefined && !targets.some(({ id }) => id === options.assertTarget)) {
    throw new Error(`Release target ${options.assertTarget} is not affected`);
  }
  process.stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release-plan: ${message}\n`);
    process.exitCode = 1;
  }
}
