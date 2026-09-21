#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type ComponentConfig = {
  readonly id: string;
  readonly paths?: readonly string[];
  readonly files?: readonly string[];
  readonly dependsOn?: readonly string[];
};

type TargetConfig = {
  readonly id: string;
  readonly component: string;
  readonly command: string;
  readonly runner: string;
  readonly supersededBy?: readonly string[];
};

type ReleaseGraph = {
  readonly version: 1;
  readonly components: readonly ComponentConfig[];
  readonly targets: readonly TargetConfig[];
  readonly ignoredPaths?: readonly string[];
  readonly ignoredFiles?: readonly string[];
};

export type AffectedComponent = {
  readonly id: string;
  readonly directFiles: readonly string[];
  readonly affectedBy: readonly string[];
};

export type PlannedTarget = {
  readonly id: string;
  readonly component: string;
  readonly command: string;
  readonly runner: string;
};

export type ReleasePlan = {
  readonly changedFiles: readonly string[];
  readonly components: readonly AffectedComponent[];
  readonly targets: readonly PlannedTarget[];
  readonly unmatchedFiles: readonly string[];
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
const graphPath = resolve(repoRoot, "release/graph.json");

export function parseReleaseGraph(raw: string): ReleaseGraph {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("release/graph.json must declare version 1");
  }
  if (!Array.isArray(value.components) || !Array.isArray(value.targets)) {
    throw new Error("release/graph.json must contain components and targets arrays");
  }

  const components = value.components.map(parseComponent);
  const targets = value.targets.map(parseTarget);
  const componentIds = new Set(components.map(({ id }) => id));
  assertUniqueIds(componentIds.size, components.length, "component");
  const targetIds = new Set(targets.map(({ id }) => id));
  assertUniqueIds(targetIds.size, targets.length, "target");

  for (const component of components) {
    for (const dependency of component.dependsOn ?? []) {
      if (!componentIds.has(dependency)) {
        throw new Error(`Component ${component.id} depends on unknown component ${dependency}`);
      }
    }
  }
  assertAcyclic(components);

  for (const target of targets) {
    if (!componentIds.has(target.component)) {
      throw new Error(`Target ${target.id} owns unknown component ${target.component}`);
    }
    for (const supersedingTarget of target.supersededBy ?? []) {
      if (!targetIds.has(supersedingTarget)) {
        throw new Error(`Target ${target.id} is superseded by unknown target ${supersedingTarget}`);
      }
    }
  }

  return {
    version: 1,
    components,
    targets,
    ignoredPaths: parseStringArray(value.ignoredPaths, "ignoredPaths"),
    ignoredFiles: parseStringArray(value.ignoredFiles, "ignoredFiles"),
  };
}

export function createReleasePlan(graph: ReleaseGraph, inputFiles: readonly string[]): ReleasePlan {
  const changedFiles = normalizeFiles(inputFiles);
  const directFiles = new Map<string, string[]>();
  const unmatchedFiles: string[] = [];

  for (const file of changedFiles) {
    let matched = false;
    for (const component of graph.components) {
      if (matchesComponent(component, file)) {
        appendMapValue(directFiles, component.id, file);
        matched = true;
      }
    }
    if (!matched && !isIgnored(graph, file)) unmatchedFiles.push(file);
  }

  const affected = new Map<string, Set<string>>();
  for (const componentId of directFiles.keys()) affected.set(componentId, new Set());

  let changed = true;
  while (changed) {
    changed = false;
    for (const component of graph.components) {
      const affectedDependencies = (component.dependsOn ?? []).filter((dependency) => affected.has(dependency));
      if (affectedDependencies.length === 0) continue;
      const reasons = affected.get(component.id) ?? new Set<string>();
      const previousSize = reasons.size;
      for (const dependency of affectedDependencies) reasons.add(dependency);
      if (!affected.has(component.id) || reasons.size !== previousSize) {
        affected.set(component.id, reasons);
        changed = true;
      }
    }
  }

  const selectedTargetIds = new Set(
    graph.targets.filter(({ component }) => affected.has(component)).map(({ id }) => id),
  );
  const targets = graph.targets
    .filter((target) => selectedTargetIds.has(target.id))
    .filter((target) => !(target.supersededBy ?? []).some((id) => selectedTargetIds.has(id)))
    .map(({ id, component, command, runner }) => ({ id, component, command, runner }));

  const components = graph.components
    .filter(({ id }) => affected.has(id))
    .map(({ id }) => ({
      id,
      directFiles: directFiles.get(id) ?? [],
      affectedBy: [...(affected.get(id) ?? [])].sort(),
    }));

  return { changedFiles, components, targets, unmatchedFiles };
}

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

function parseComponent(value: unknown, index: number): ComponentConfig {
  if (!isRecord(value)) throw new Error(`components[${index}] must be an object`);
  const id = parseIdentifier(value.id, `components[${index}].id`);
  const paths = parseStringArray(value.paths, `components[${index}].paths`);
  const files = parseStringArray(value.files, `components[${index}].files`);
  if (paths.length === 0 && files.length === 0) {
    throw new Error(`Component ${id} must own at least one path or file`);
  }
  for (const path of paths) {
    if (!path.endsWith("/")) throw new Error(`Component path must end with /: ${path}`);
  }
  return {
    id,
    paths,
    files,
    dependsOn: parseStringArray(value.dependsOn, `components[${index}].dependsOn`),
  };
}

function parseTarget(value: unknown, index: number): TargetConfig {
  if (!isRecord(value)) throw new Error(`targets[${index}] must be an object`);
  return {
    id: parseIdentifier(value.id, `targets[${index}].id`),
    component: parseIdentifier(value.component, `targets[${index}].component`),
    command: parseNonEmptyString(value.command, `targets[${index}].command`),
    runner: parseNonEmptyString(value.runner, `targets[${index}].runner`),
    supersededBy: parseStringArray(value.supersededBy, `targets[${index}].supersededBy`),
  };
}

function assertUniqueIds(actual: number, expected: number, kind: string): void {
  if (actual !== expected) throw new Error(`Duplicate ${kind} id in release graph`);
}

function assertAcyclic(components: readonly ComponentConfig[]): void {
  const byId = new Map(components.map((component) => [component.id, component]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Release component dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };

  for (const component of components) visit(component.id);
}

function normalizeFiles(files: readonly string[]): string[] {
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

function matchesComponent(component: ComponentConfig, file: string): boolean {
  return (component.files ?? []).includes(file) || (component.paths ?? []).some((path) => file.startsWith(path));
}

function isIgnored(graph: ReleaseGraph, file: string): boolean {
  return (graph.ignoredFiles ?? []).includes(file) || (graph.ignoredPaths ?? []).some((path) => file.startsWith(path));
}

function appendMapValue(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}

function parseIdentifier(value: unknown, field: string): string {
  const result = parseNonEmptyString(value, field);
  if (!/^[a-z][a-z0-9-]*$/u.test(result)) throw new Error(`${field} must be a kebab-case identifier`);
  return result;
}

function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function parseStringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readChangedFiles(options: CliOptions): readonly string[] {
  if (options.files !== undefined) return options.files;
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
  return [...files];
}

function runGitNameStatus(args: readonly string[]): readonly string[] {
  return parseGitNameStatus(runGitRaw(args));
}

function runGit(args: readonly string[]): readonly string[] {
  return runGitRaw(args).split("\n").filter((line) => line.length > 0);
}

function runGitRaw(args: readonly string[]): string {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", shell: false });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function formatPlan(plan: ReleasePlan): string {
  const lines = [
    `Changed files: ${plan.changedFiles.length}`,
    `Affected components: ${plan.components.length === 0 ? "none" : plan.components.map(({ id }) => id).join(", ")}`,
    `Release targets: ${plan.targets.length === 0 ? "none" : plan.targets.map(({ id }) => id).join(", ")}`,
  ];
  for (const target of plan.targets) lines.push(`- ${target.id} [${target.runner}]: ${target.command}`);
  if (plan.unmatchedFiles.length > 0) {
    lines.push("Unmatched files (review graph coverage):");
    for (const file of plan.unmatchedFiles) lines.push(`- ${file}`);
  }
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const graph = parseReleaseGraph(readFileSync(graphPath, "utf8"));
  const plan = createReleasePlan(graph, readChangedFiles(options));
  if (options.assertTarget !== undefined && !plan.targets.some(({ id }) => id === options.assertTarget)) {
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
