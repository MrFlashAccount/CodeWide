#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Bump = "major" | "minor" | "patch";

type ReleaseMetadata = {
  readonly id: string;
  readonly runner: string;
  readonly tagPrefix: string;
  readonly baselineVersion: string;
  readonly order: number;
};

type ReleaseProject = ReleaseMetadata & {
  readonly project: string;
};

type ReleaseSetTarget = ReleaseProject & {
  readonly base: string;
  readonly previousVersion: string;
  readonly version: string;
};

type ReleaseSetPlan = {
  readonly bump: Bump;
  readonly sourceRevision: string;
  readonly targets: readonly ReleaseSetTarget[];
};

type CliOptions = {
  readonly bump: Bump;
  readonly base: string | undefined;
  readonly head: string;
  readonly files: readonly string[] | undefined;
  readonly json: boolean;
};

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nxCli = resolve(repoRoot, "node_modules/.bin/nx");
const releasePlanner = resolve(repoRoot, "scripts/release-plan.ts");

function parseArguments(args: readonly string[]): CliOptions {
  let bump: Bump | undefined;
  let base: string | undefined;
  let head = "HEAD";
  let files: readonly string[] | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--bump") bump = parseBump(requireArgument(args, ++index, argument));
    else if (argument === "--base") base = requireArgument(args, ++index, argument);
    else if (argument === "--head") head = requireArgument(args, ++index, argument);
    else if (argument === "--files") files = requireArgument(args, ++index, argument).split(",");
    else if (argument === "--json") json = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (bump === undefined) throw new Error("--bump must be patch, minor, or major");
  return { bump, base, head, files, json };
}

function parseBump(value: string): Bump {
  if (value === "patch" || value === "minor" || value === "major") return value;
  throw new Error(`Unsupported version bump: ${value}`);
}

function requireArgument(args: readonly string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function readReleaseProjects(): readonly ReleaseProject[] {
  const value: unknown = JSON.parse(runCommand(nxCli, ["show", "projects", "--withTarget=release", "--json"]));
  if (!Array.isArray(value) || value.some((project) => typeof project !== "string")) {
    throw new Error("Nx returned an invalid release-project list");
  }
  return value.map(readReleaseProject).sort((left, right) => left.order - right.order);
}

function readReleaseProject(project: string): ReleaseProject {
  const value: unknown = JSON.parse(runCommand(nxCli, ["show", "project", project, "--json"]));
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.metadata.codewideRelease)) {
    throw new Error(`Nx project ${project} has no codewideRelease metadata`);
  }
  const metadata = value.metadata.codewideRelease;
  return {
    project,
    id: nonEmptyString(metadata.id, `${project}.id`),
    runner: nonEmptyString(metadata.runner, `${project}.runner`),
    tagPrefix: nonEmptyString(metadata.tagPrefix, `${project}.tagPrefix`),
    baselineVersion: version(metadata.baselineVersion, `${project}.baselineVersion`),
    order: nonNegativeInteger(metadata.order, `${project}.order`),
  };
}

function planReleaseSet(options: CliOptions): ReleaseSetPlan {
  const sourceRevision = runGit(["rev-parse", options.head]);
  const projects = readReleaseProjects();
  const selected = options.files === undefined
    ? selectSinceLastRelease(projects, options, sourceRevision)
    : selectForFiles(projects, options.files);
  const targets = selected.map(({ project, base, previousVersion }) => ({
    ...project,
    base,
    previousVersion,
    version: bumpVersion(previousVersion, options.bump),
  }));
  return { bump: options.bump, sourceRevision, targets };
}

function selectSinceLastRelease(
  projects: readonly ReleaseProject[],
  options: CliOptions,
  sourceRevision: string,
): readonly { readonly project: ReleaseProject; readonly base: string; readonly previousVersion: string }[] {
  const firstCommit = runGit(["rev-list", "--max-parents=0", sourceRevision]).split("\n")[0];
  if (firstCommit === undefined || firstCommit.length === 0) throw new Error("Could not resolve the first repository commit");
  const plans = new Map<string, ReadonlySet<string>>();
  const selected: { project: ReleaseProject; base: string; previousVersion: string }[] = [];
  for (const project of projects) {
    const latestTag = latestStableTag(project.tagPrefix, sourceRevision);
    const base = options.base ?? latestTag ?? firstCommit;
    let affected = plans.get(base);
    if (affected === undefined) {
      affected = readAffectedTargetIds(["--base", base, "--head", sourceRevision]);
      plans.set(base, affected);
    }
    if (!affected.has(project.id)) continue;
    const previousVersion = latestTag === undefined
      ? project.baselineVersion
      : version(latestTag.slice(project.tagPrefix.length), `tag ${latestTag}`);
    selected.push({ project, base, previousVersion });
  }
  return selected;
}

function selectForFiles(
  projects: readonly ReleaseProject[],
  files: readonly string[],
): readonly { readonly project: ReleaseProject; readonly base: string; readonly previousVersion: string }[] {
  const affected = readAffectedTargetIds(["--files", files.join(",")]);
  return projects
    .filter(({ id }) => affected.has(id))
    .map((project) => ({ project, base: "explicit-files", previousVersion: project.baselineVersion }));
}

function readAffectedTargetIds(args: readonly string[]): ReadonlySet<string> {
  const value: unknown = JSON.parse(runCommand(process.execPath, [releasePlanner, ...args, "--json"]));
  if (!isRecord(value) || !Array.isArray(value.targets)) throw new Error("Release planner returned invalid JSON");
  const ids = new Set<string>();
  for (const target of value.targets) {
    if (!isRecord(target) || typeof target.id !== "string") throw new Error("Release planner returned an invalid target");
    ids.add(target.id);
  }
  return ids;
}

function latestStableTag(prefix: string, head: string): string | undefined {
  const tags = runGit(["tag", "--merged", head, "--list", `${prefix}[0-9]*`, "--sort=-version:refname"]);
  return tags.split("\n").find((tag) => {
    if (!tag.startsWith(prefix)) return false;
    return /^\d+\.\d+\.\d+$/u.test(tag.slice(prefix.length));
  });
}

export function bumpVersion(current: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(current);
  if (match === null) throw new Error(`Version must be MAJOR.MINOR.PATCH: ${current}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function version(value: unknown, field: string): string {
  const parsed = nonEmptyString(value, field);
  if (!/^\d+\.\d+\.\d+$/u.test(parsed)) throw new Error(`${field} must be MAJOR.MINOR.PATCH`);
  return parsed;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runGit(args: readonly string[]): string {
  return runCommand("git", args);
}

function runCommand(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", shell: false });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function formatPlan(plan: ReleaseSetPlan): string {
  const lines = [
    `Source: ${plan.sourceRevision}`,
    `Bump: ${plan.bump}`,
    `Release set: ${plan.targets.length === 0 ? "none" : plan.targets.map(({ id, version: next }) => `${id}@${next}`).join(", ")}`,
  ];
  for (const target of plan.targets) {
    lines.push(`- ${target.id}: ${target.previousVersion} -> ${target.version} (base ${target.base})`);
  }
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const plan = planReleaseSet(options);
  process.stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release-set-plan: ${message}\n`);
    process.exitCode = 1;
  }
}
