import { describe, expect, it } from "vitest";

import type { V2QueryResult } from "@codewide/sync-client/v2";
import { accountLoginSupported } from "../src/v2/features/settings/accountSettingsPresentation";

describe("V2 account settings capabilities", () => {
  it("requires both runtime login commands", () => {
    expect(accountLoginSupported(capabilities(["account.login.start"]))).toBe(false);
    expect(accountLoginSupported(capabilities(["account.login.cancel"]))).toBe(false);
    expect(
      accountLoginSupported(capabilities(["account.login.start", "account.login.cancel"])),
    ).toBe(true);
  });

  it("does not infer login support from another query result", () => {
    expect(
      accountLoginSupported({
        activeProfileId: null,
        allExhausted: false,
        kind: "accounts.list",
        profiles: [],
      }),
    ).toBe(false);
  });
});

function capabilities(commands: string[]): V2QueryResult {
  return {
    commands,
    kind: "capabilities.read",
    limits: {
      catalogPerPartitionMax: 100,
      historyPageMax: 100,
      queueMaxBytes: 4_194_304,
      queueMaxEvents: 2_048,
      turnWindowMax: 36,
    },
    queries: [],
  };
}
