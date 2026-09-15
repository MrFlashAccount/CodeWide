import { expect, it } from "vitest";
import { pendingRequestsProjection } from "./requests-sources";

it("preserves requests integration contracts", () => {
  expect(pendingRequestsProjection).toContain("useLiveQuery(");
});
