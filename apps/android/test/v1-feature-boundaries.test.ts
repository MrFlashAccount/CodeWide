import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const androidRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../eslint.config.js", import.meta.url));
const { ESLint } = require("eslint");

describe("V1 feature gate coverage", () => {
  it("routes the required V1 gate through every quality owner", async () => {
    const manifest = JSON.parse(readFileSync(join(androidRoot, "package.json"), "utf8"));
    expect(manifest.scripts["validate:v1"]).toContain("format:v1:check");
    expect(manifest.scripts["validate:v1"]).toContain("lint:v1");
    expect(manifest.scripts["lint:v1"]).toContain("lint:v1:source");
    expect(manifest.scripts["lint:v1"]).toContain("lint:v1:dead-code");
    expect(manifest.scripts["lint:v1"]).toContain("lint:v1:dependencies");
    expect(manifest.scripts["lint:v1:source"]).toContain("lint:v1:hygiene");
    expect(manifest.scripts["lint:v1:source"]).toContain("lint:v1:layout");

    const hygiene = (await import(new URL("../oxlint.v1.config.mjs", import.meta.url))).default;
    expect(hygiene.rules["hygiene/require-type-assertion-justification"]).toBe("error");
    expect(hygiene.ignorePatterns).not.toContain("app/legacy.tsx");
    expect(hygiene.ignorePatterns).toEqual(
      expect.arrayContaining(["src/boot/**", "src/presentation/**", "src/v2/**"]),
    );

    const knip = (await import(new URL("../knip.v1.config.mjs", import.meta.url))).default;
    expect(knip.entry).toEqual(expect.arrayContaining(["app/legacy.tsx", "test/**/*.{ts,tsx}"]));
    expect(knip.project).toEqual(expect.arrayContaining(["app/legacy.tsx", "src/**/*.{ts,tsx}"]));
  });

  it("applies presentation, React, layout, style, and public-API rules to a V1 feature path", async () => {
    const eslint = new ESLint({ cwd: androidRoot });
    const results = await eslint.lintText(
      `
      import { useState } from "react";
      import { StyleSheet, Text } from "react-native";
      export function WorkspaceScreen({ enabled }) {
        if (enabled) useState(0);
        return <Text style={[styles.root, { fontSize: 15 }]} />;
      }
      const styles = StyleSheet.create({ root: { color: "red", flex: 1 } });
    `,
      { filePath: "src/features/workspace/WorkspaceScreen.tsx" },
    );
    expect(results[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "codewide-v1/imports-separated-from-code" }),
        expect.objectContaining({ ruleId: "codewide-v1/require-public-export-jsdoc" }),
        expect.objectContaining({ ruleId: "codewide-v1/stylesheet-properties-multiline" }),
        expect.objectContaining({ ruleId: "codewide/presentation-tokens" }),
        expect.objectContaining({ ruleId: "react-hooks/rules-of-hooks" }),
      ]),
    );
  });

  it("allows lower capability consumption and rejects reversed, V2, and type-cycle edges", () => {
    const fixture = mkdtempSync(join(tmpdir(), "codewide-v1-boundary-"));
    const files = {
      "src/data/capability.ts": "export type Capability = { read(): void };",
      "src/features/allowed/contracts.ts":
        'import type { Capability } from "../../data/capability"; export type Feature = Capability;',
      "src/data/forbidden.ts":
        'import type { Feature } from "../features/allowed/contracts"; export type Lower = Feature;',
      "src/native/forbidden.ts":
        'import type { Feature } from "../features/allowed/contracts"; export type Native = Feature;',
      "src/v2/contract.ts": "export type V2 = { generation: 2 };",
      "app/legacy.tsx":
        'import type { V2 } from "../src/v2/contract"; export type LegacyRoute = V2;',
      "src/features/forbidden/v2.ts":
        'import type { V2 } from "../../v2/contract"; export type Legacy = V2;',
      "src/features/cycle/a.ts": 'import type { B } from "./b"; export type A = { b: B };',
      "src/features/cycle/b.ts": 'import type { A } from "./a"; export type B = { a: A };',
      "src/features/projects/projectPickerContract.ts": "export type Project = { path: string };",
      "src/features/projects/privateSession.ts": "export type Private = { pending: boolean };",
      "src/features/allowed/project.ts":
        'import type { Project } from "../projects/projectPickerContract"; export type Public = Project;',
      "src/features/forbidden/private.ts":
        'import type { Private } from "../projects/privateSession"; export type Leaked = Private;',
      "src/features/conversation/privateScope.ts": "export type Scope = { thread: string };",
      "src/features/conversation/ConversationReadSurface.tsx":
        "export type ReadSurface = { readonly: true };",
      "src/features/goal/ThreadGoalChip.tsx": "export type GoalChip = { goal: true };",
      "src/features/requests/RequestFeature.tsx": "export type RequestPrompt = { request: true };",
      "src/features/conversation/timeline/forbiddenGoal.tsx":
        'import type { GoalChip } from "../../goal/ThreadGoalChip"; export type Leaked = GoalChip;',
      "src/features/conversation/turns/forbiddenRequest.tsx":
        'import type { RequestPrompt } from "../../requests/RequestFeature"; export type Leaked = RequestPrompt;',
      "src/features/conversation/workspaceAdapter.ts": "export type Adapter = { commands: true };",
      "src/features/allowed/readSurface.ts":
        'import type { ReadSurface } from "../conversation/ConversationReadSurface"; export type Read = ReadSurface;',
      "src/features/forbidden/conversationScope.ts":
        'import type { Scope } from "../conversation/privateScope"; export type Leaked = Scope;',
      "src/features/forbidden/adapter.ts":
        'import type { Adapter } from "../conversation/workspaceAdapter"; export type Leaked = Adapter;',
      "src/features/workspace/createWorkspaceFeatures.ts":
        'import type { Adapter } from "../conversation/workspaceAdapter"; export type Bound = Adapter;',
      "src/data/use-remote-workspace.ts": "export type Workspace = { all: true };",
      "src/features/search/forbiddenFacade.ts":
        'import type { Workspace } from "../../data/use-remote-workspace"; export type Leaked = Workspace;',
      "src/CodeWideScreen.tsx": "export type Composition = { route: string };",
      "src/features/forbidden/root.ts":
        'import type { Composition } from "../../CodeWideScreen"; export type Feature = Composition;',
    };
    try {
      for (const [relativePath, source] of Object.entries(files)) {
        const path = join(fixture, relativePath);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, source);
      }
      // The fixture uses the production rules and resolver; only the config file location differs.
      writeFileSync(
        join(fixture, "config.mjs"),
        `
        import config from ${JSON.stringify(new URL("../dependency-cruiser.v1.config.mjs", import.meta.url).href)};
        export default { ...config, options: { ...config.options, tsConfig: { fileName: ${JSON.stringify(join(androidRoot, "tsconfig.json"))} } } };
      `,
      );
      const rejection = spawnSync(
        process.execPath,
        [
          join(androidRoot, "node_modules/dependency-cruiser/bin/dependency-cruise.mjs"),
          "--config",
          "config.mjs",
          "--output-type",
          "err",
          "app",
          "src",
        ],
        { cwd: fixture, encoding: "utf8" },
      );
      expect(rejection.error).toBeUndefined();
      expect(rejection.status, rejection.stderr || rejection.stdout).toBeGreaterThan(0);
      const result = spawnSync(
        process.execPath,
        [
          join(androidRoot, "node_modules/dependency-cruiser/bin/dependency-cruise.mjs"),
          "--config",
          "config.mjs",
          "--output-type",
          "json",
          "app",
          "src",
        ],
        { cwd: fixture, encoding: "utf8" },
      );
      expect(result.error).toBeUndefined();
      // JSON is a report-only output; the production err reporter above owns the failing exit code.
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.summary.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: "src/features/forbidden/conversationScope.ts",
            rule: expect.objectContaining({ name: "v1-conversation-private-modules-stay-local" }),
          }),
          expect.objectContaining({
            from: "src/features/forbidden/adapter.ts",
            rule: expect.objectContaining({ name: "v1-conversation-adapter-is-composition-only" }),
          }),
          expect.objectContaining({
            from: "src/features/forbidden/private.ts",
            to: "src/features/projects/privateSession.ts",
            rule: expect.objectContaining({ name: "v1-projects-private-modules-stay-local" }),
          }),
          expect.objectContaining({
            from: "src/features/search/forbiddenFacade.ts",
            rule: expect.objectContaining({
              name: "v1-migrated-features-do-not-import-workspace-facade",
            }),
          }),
          expect.objectContaining({
            from: "src/data/forbidden.ts",
            to: "src/features/allowed/contracts.ts",
            rule: expect.objectContaining({ name: "v1-lower-owners-do-not-import-features" }),
          }),
          expect.objectContaining({
            from: "src/native/forbidden.ts",
            to: "src/features/allowed/contracts.ts",
            rule: expect.objectContaining({ name: "v1-lower-owners-do-not-import-features" }),
          }),
          expect.objectContaining({
            from: "src/features/forbidden/v2.ts",
            to: "src/v2/contract.ts",
            rule: expect.objectContaining({ name: "v1-does-not-import-v2" }),
          }),
          expect.objectContaining({
            from: "app/legacy.tsx",
            to: "src/v2/contract.ts",
            rule: expect.objectContaining({ name: "v1-does-not-import-v2" }),
          }),
          expect.objectContaining({
            from: "src/features/cycle/a.ts",
            rule: expect.objectContaining({ name: "v1-no-circular-dependencies" }),
          }),
          expect.objectContaining({
            from: "src/features/forbidden/root.ts",
            to: "src/CodeWideScreen.tsx",
            rule: expect.objectContaining({ name: "v1-features-do-not-import-root-composition" }),
          }),
          expect.objectContaining({
            from: "src/features/conversation/timeline/forbiddenGoal.tsx",
            to: "src/features/goal/ThreadGoalChip.tsx",
            rule: expect.objectContaining({
              name: "v1-conversation-read-owners-do-not-import-feature-composition",
            }),
          }),
          expect.objectContaining({
            from: "src/features/conversation/turns/forbiddenRequest.tsx",
            to: "src/features/requests/RequestFeature.tsx",
            rule: expect.objectContaining({
              name: "v1-conversation-read-owners-do-not-import-feature-composition",
            }),
          }),
        ]),
      );
      expect(report.summary.violations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "src/features/allowed/contracts.ts" }),
          expect.objectContaining({ from: "src/features/allowed/project.ts" }),
          expect.objectContaining({ from: "src/features/allowed/readSurface.ts" }),
          expect.objectContaining({ from: "src/features/workspace/createWorkspaceFeatures.ts" }),
        ]),
      );
      expect(report.summary.violations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: expect.objectContaining({ name: "v1-no-unresolved-dependencies" }),
          }),
        ]),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
