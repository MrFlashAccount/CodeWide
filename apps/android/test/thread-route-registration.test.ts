import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every thread child destination presents over the conversation through the
 * thread stack's own screen options (a sheet or a transparent fullscreen
 * modal). An unregistered route falls back to an opaque card push that covers
 * the conversation hosting its fullscreen overlay, so it opens invisibly.
 */
const THREAD_ROUTE = join(
  __dirname,
  "../app/(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]",
);

function routeNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return routeNames(path);
    }
    return entry.name.endsWith(".tsx") && !entry.name.startsWith("_")
      ? [relative(THREAD_ROUTE, path).replace(/\.tsx$/u, "")]
      : [];
  });
}

describe("thread route stack", () => {
  it("registers every child destination with its presentation", () => {
    const layout = readFileSync(join(THREAD_ROUTE, "_layout.tsx"), "utf8");
    const registered = new Set(
      [...layout.matchAll(/<Stack\.Screen name="([^"]+)"/gu)].map((match) => match[1]),
    );
    const children = routeNames(THREAD_ROUTE).filter((name) => name !== "index");
    expect(children.filter((name) => !registered.has(name))).toEqual([]);
  });
});
