import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const source = compactSource(readFileSync(new URL("../src/ui/ProjectPickerSheet.tsx", import.meta.url), "utf8"));

describe("project picker", () => {
  it("pins discovered projects without selecting them", () => {
    const pinProjectStart = source.indexOf("const pinProject = async");
    const pinProjectEnd = source.indexOf("}; return (", pinProjectStart) + 2;
    const pinProject = source.slice(pinProjectStart, pinProjectEnd);

    expect(pinProject).toContain("await onAddProject(project.path)");
    expect(pinProject).not.toContain("onSelect(");
    expect(source).toContain("const canPin = !item.pinned && onAddProject !== undefined && onManageProjects === undefined");
    expect(source).toContain("onPin={canPin ? () => void pinProject(item.project) : undefined}");
    expect(source).toContain('label: "Pin"');
  });
});
