import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RouteNode } from "expo-router/build/Route";
import { getRoutes } from "expo-router/build/getRoutes";
import { stripInvisibleSegmentsFromPath } from "expo-router/build/matchers";
import requireContext from "expo-router/build/testing-library/require-context-ponyfill";
import { describe, expect, it } from "vitest";

const android = fileURLToPath(new URL("../", import.meta.url));

describe("Unversioned application entry", () => {
  it("resolves public destinations without a generation prefix or helper routes", () => {
    // Expo's metadata-only discovery reads the real route tree without requiring native screens in Node.
    const tree = getRoutes(requireContext(join(android, "app")), {
      ignoreEntryPoints: true,
      ignoreRequireErrors: true,
      platform: "android",
    });
    if (tree === null) throw new Error("Application route tree is empty");
    const paths: string[] = [];
    function collect(node: RouteNode, parent: string): void {
      const path = [parent, node.route].filter(Boolean).join("/");
      if (node.type === "route" && !node.internal) {
        paths.push(`/${stripInvisibleSegmentsFromPath(path)}`);
      }
      for (const child of node.children) collect(child, path);
    }
    collect(tree, "");
    expect(paths).toEqual(expect.arrayContaining([
      "/", "/new", "/search", "/settings", "/projects",
      "/browser/[sessionId]", "/drawing/[sessionId]",
      "/threads/[connectionId]/[threadId]",
      "/threads/[connectionId]/[threadId]/terminal",
      "/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
    ]));
    expect(paths.filter((path) => /^\/v[12]/iu.test(path))).toEqual([]);
    expect(paths.filter((path) => /Workspace|RouteSession|RouteNavigation/u.test(path))).toEqual([]);
    expect(paths.filter((path) => path === "/")).toHaveLength(1);
  });

  it("publishes one workspace and the public compatibility aliases", () => {
    const routes = readdirSync(join(android, "app"), { withFileTypes: true });
    expect(routes.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).toEqual([
      "(workspace)",
    ]);
    expect(existsSync(join(android, "app/index.tsx"))).toBe(false);
    expect(existsSync(join(android, "app/(workspace)/(lists)/index.tsx"))).toBe(true);
    for (const alias of ["legacy", "pair", "thread"]) {
      const route = readFileSync(join(android, "app", `${alias}.tsx`), "utf8");
      expect(route).toContain('href="/"');
      expect(route).not.toContain("Generation");
    }
  });

  it("cannot load the retired UI through a stored preference or diagnostics host", () => {
    const root = readFileSync(join(android, "app/_layout.tsx"), "utf8");
    const workspace = readFileSync(join(android, "app/(workspace)/_layout.tsx"), "utf8");
    for (const source of [root, workspace]) {
      expect(source).not.toMatch(/UiGeneration|uiGeneration|V2Application|src\/v2\//u);
    }
    expect(root).toContain("<AppLockGate>");
    // The framework shell must not retain a second native stack around the workspace.
    expect(root).toContain("<Slot />");
    expect(root).not.toContain("<Stack");
    expect(existsSync(join(android, "app/+not-found.tsx"))).toBe(true);
    expect(root).toContain("<NavigationPerformanceHud />");
    expect(existsSync(join(android, "src/v2/V2Application.tsx"))).toBe(false);
  });
});
