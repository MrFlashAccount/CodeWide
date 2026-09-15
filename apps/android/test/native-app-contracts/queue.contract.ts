import { expect, it } from "vitest";
import { queueWorkspaceAdapter, migratedQueueFeature } from "./queue-sources";

it("preserves queue integration contracts", () => {
  expect(queueWorkspaceAdapter).toContain('"companion/queue/steer"');
  expect(migratedQueueFeature).toContain('accessibilityLabel="Drag queued prompt"');
  expect(migratedQueueFeature).toContain('accessibilityLabel="Steer queued prompt"');
  expect(queueWorkspaceAdapter).toContain("details.planQueuedRemoval(connectionId, commandId)");
});
