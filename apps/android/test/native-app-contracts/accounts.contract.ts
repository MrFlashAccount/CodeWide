import { expect, it } from "vitest";
import { accountWorkspaceAdapter } from "./accounts-sources";

it("preserves accounts integration contracts", () => {
  expect(accountWorkspaceAdapter).toContain('"companion/accountPool/profile/activate"');
});
