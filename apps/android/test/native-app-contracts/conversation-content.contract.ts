import { expect, it } from "vitest";
import { ownerAgentResponseMarkdown } from "./conversation-content-sources";

it("preserves conversation content integration contracts", () => {
  expect(ownerAgentResponseMarkdown).toContain(
    "`complete-markdown:${resourceScope}:${reference.id}:${String(reference.byteLength)}`",
  );
  expect(ownerAgentResponseMarkdown).toContain("readPrivateAssetText(");
});
