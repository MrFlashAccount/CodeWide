import { describe, expect, it } from "vitest";
import { projectAgentArtifacts } from "../src/rendering/agent-artifacts";
import { projectUserMessageAttachments } from "../src/rendering/user-message-attachments";
import { compactTurnArtifactReferences } from "../src/data/turn-artifacts";

describe("bubble attachment projections", () => {
  it.each(["content", "contentItems", "output"])("retains %s image references when activity is unloaded", (field) => {
    const asset = { version: 1, id: "a".repeat(64), byteLength: 1234, contentType: "image/png" };
    const full = { items: [{ type: "dynamicToolCall", [field]: [
      { type: "image", codewideAsset: asset },
      { type: "resource_link", uri: "/tmp/report.txt" },
      { type: "text", text: "Very long tool output" },
    ] }] };
    const references = compactTurnArtifactReferences(full);
    const summary = { items: [], codewide: { artifacts: references } };
    expect(projectAgentArtifacts(summary)).toEqual(projectAgentArtifacts(full));
    expect(projectAgentArtifacts(summary).map((item) => item.kind)).toEqual(["image", "file"]);
    expect(JSON.stringify(summary)).not.toContain("Very long tool output");
    expect(compactTurnArtifactReferences({ ...full, codewide: summary.codewide })).toEqual(references);
  });
  it("retains MCP result image references without its output body", () => {
    const full = { items: [{ type: "mcpToolCall", result: { content: [
      { type: "image", codewideAsset: { version: 1, id: "b".repeat(64), byteLength: 20, contentType: "image/webp" } },
    ] } }] };
    const references = compactTurnArtifactReferences(full);
    expect(references).toHaveLength(1);
    expect(projectAgentArtifacts({ items: [], codewide: { artifacts: references } })).toEqual(projectAgentArtifacts(full));
  });
  it("shows generated artifacts without loading activity or waiting for prose", () => {
    expect(projectAgentArtifacts({ status: "inProgress", items: [], codewide: { artifacts: [{ savedPath: "/tmp/output.png" }] } })).toEqual([
      { kind: "image", name: "output.png", source: { type: "path", path: "/tmp/output.png" } },
    ]);
  });
  it("deduplicates metadata, tool output and the authored artifact link", () => {
    const turn = { items: [
      { type: "imageGeneration", savedPath: "/tmp/output.png" },
      { type: "agentMessage", text: "Done. [Picture](/tmp/output.png) ![Picture](/tmp/output.png) [Report](/tmp/report.md)" },
    ], codewide: { artifacts: [{ savedPath: "/tmp/output.png" }] } };
    expect(projectAgentArtifacts(turn).map((item) => item.name)).toEqual(["output.png", "report.md"]);
  });
  it("does not invent outputs from commands, changed files, image inputs, code or ordinary web links", () => {
    expect(projectAgentArtifacts({ items: [
      { type: "commandExecution", aggregatedOutput: "/tmp/output.png" },
      { type: "imageView", path: "/tmp/input.png" },
      { type: "fileChange", changes: [{ path: "/tmp/source.ts" }] },
      { type: "agentMessage", text: "`[not an artifact](/tmp/code.png)` [Reference](/tmp/source.ts:12) [Docs](https://example.com)" },
    ] })).toEqual([]);
  });
  it("supports reference links and sandbox artifact paths", () => {
    expect(projectAgentArtifacts({ items: [{ type: "agentMessage", text: "[Report][result]\n\n[result]: sandbox:/mnt/data/report.pdf" }] })[0]?.source)
      .toEqual({ type: "path", path: "/mnt/data/report.pdf" });
  });
  it("projects an SVG artifact into the image gallery", () => {
    expect(projectAgentArtifacts({ items: [{ type: "agentMessage", text: "[Diagram](sandbox:/mnt/data/flow.SVG)" }] })).toEqual([
      { kind: "image", name: "flow.SVG", source: { path: "/mnt/data/flow.SVG", type: "path" } },
    ]);
  });
  it("recognizes image attachments in the persisted user file envelope", () => {
    expect(projectUserMessageAttachments([{ type: "text", text: "# Files mentioned by the user:\n\n## drawing.png: /tmp/drawing.png\n\n## My request for Codex:\n\nLook." }])[0]?.kind).toBe("image");
  });
  it("rejects malformed metadata rather than manufacturing broken cards", () => {
    expect(projectAgentArtifacts({ codewide: { artifacts: [null, { savedPath: 3 }, { codewideAsset: {} }] }, items: [null, 3] })).toEqual([]);
  });
});
