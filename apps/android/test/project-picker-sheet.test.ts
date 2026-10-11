import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const source = compactSource(readFileSync(new URL("../src/features/projects/ProjectPickerSheet.tsx", import.meta.url), "utf8"));

const session = compactSource(readFileSync(new URL("../src/features/projects/projectPickerSession.ts", import.meta.url), "utf8"));

const content = compactSource(readFileSync(new URL("../src/features/projects/ProjectPickerContent.tsx", import.meta.url), "utf8"));

const row = compactSource(readFileSync(new URL("../src/features/projects/ProjectPickerRowViews.tsx", import.meta.url), "utf8"));

describe("project picker", () => {
  it("pins discovered projects without selecting them", () => {
    const pinProject = session.slice(session.indexOf("const pinProject ="));

    // Pinning is scoped to the choice's server since multi-server project picking.
    expect(pinProject).toContain("await onAddProject(choice.server.id, choice.project.path)");
    expect(pinProject).not.toContain("onSelect(");
    expect(content).toContain("const canPin = !item.pinned && onAddProject !== undefined && onManageProjects === undefined");
    expect(content).toContain("onPin={canPin ? () => void pinProject(item.choice) : undefined}");
    expect(row).toContain('label: "Pin"');
  });
});
