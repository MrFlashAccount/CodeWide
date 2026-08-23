import { describe, expect, it } from "vitest";

import { normalizeProjectCwd, projectLabel, threadContextLabel } from "../src/data/thread-projects";

describe("thread projects", () => {
  it("normalizes harmless path spelling differences", () => {
    expect(normalizeProjectCwd(" /work//codewide/ ")).toBe("/work/codewide");
    expect(normalizeProjectCwd("C:/work/codewide/")).toBe("C:\\work\\codewide");
  });

  it("labels Unix and Windows working directories", () => {
    expect(projectLabel("/work/codewide/")).toBe("codewide");
    expect(projectLabel("C:\\work\\codewide")).toBe("codewide");
  });

  it("labels an open thread with its server and project", () => {
    expect(threadContextLabel("Workstation", "/work/codewide")).toBe("Workstation · codewide");
    expect(threadContextLabel("Workstation", "/work/codewide", "Mobile workspace")).toBe("Workstation · Mobile workspace");
  });

  it("falls back without rendering empty context segments", () => {
    expect(threadContextLabel("", "/work/codewide")).toBe("codewide");
    expect(threadContextLabel("Workstation", "")).toBe("Workstation · workspace");
  });
});
