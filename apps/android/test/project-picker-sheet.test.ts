import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/ui/ProjectPickerSheet.tsx", import.meta.url), "utf8");

describe("project picker", () => {
  it("pins discovered projects without selecting them", () => {
    const pinProjectStart = source.indexOf("const pinProject = async");
    const pinProjectEnd = source.indexOf("\n\n  return (", pinProjectStart);
    const pinProject = source.slice(pinProjectStart, pinProjectEnd);

    expect(pinProject).toContain("await onAddProject(project.path)");
    expect(pinProject).not.toContain("onSelect(");
    expect(source.match(/onPin=\{onAddProject === undefined \? undefined : \(\) => void pinProject\(project\)\}/gu)).toHaveLength(2);
    expect(source).toContain('label: "Pin"');
    expect(source).toContain("pinned || onAddProject === undefined ? undefined : () => void pinProject(project)");
  });
});
