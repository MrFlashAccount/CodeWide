import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const source = compactSource(readFileSync(new URL("../src/features/projects/ProjectPickerSheet.tsx", import.meta.url), "utf8"));

const session = compactSource(readFileSync(new URL("../src/features/projects/projectPickerSession.ts", import.meta.url), "utf8"));

const content = compactSource(readFileSync(new URL("../src/features/projects/ProjectPickerContent.tsx", import.meta.url), "utf8"));

const row = compactSource(readFileSync(new URL("../src/features/projects/ProjectPickerRows.tsx", import.meta.url), "utf8"));

describe("project picker", () => {
  it("pins discovered projects without selecting them", () => {
    const pinProject = session.slice(session.indexOf("const pinProject ="));

    expect(pinProject).toContain("await onAddProject(project.path)");
    expect(pinProject).not.toContain("onSelect(");
    expect(content).toContain("const canPin = !item.pinned && onAddProject !== undefined && onManageProjects === undefined");
    expect(content).toContain("onPin={canPin ? () => void pinProject(item.project) : undefined}");
    expect(row).toContain('label: "Pin"');
  });
});
