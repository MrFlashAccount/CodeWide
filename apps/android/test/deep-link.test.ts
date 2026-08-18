import { describe, expect, it } from "vitest";

import { parseThreadDeepLink } from "../src/data/deep-link";

describe("thread notification deep links", () => {
  it("decodes composite connection and remote-thread identity", () => {
    expect(parseThreadDeepLink("codewide://thread?connectionId=home%2Fserver&threadId=thread%3A7")).toEqual({
      connectionId: "home/server",
      threadId: "thread:7",
    });
  });

  it("keeps legacy Codex Remote notification links working", () => {
    expect(parseThreadDeepLink("codexremote://thread?connectionId=legacy&threadId=thread-1")).toEqual({
      connectionId: "legacy",
      threadId: "thread-1",
    });
  });

  it.each([
    "https://thread?connectionId=a&threadId=b",
    "codewide://settings?connectionId=a&threadId=b",
    "codewide://thread?connectionId=a",
    "not a url",
  ])("rejects unrelated or malformed URL %s", (url) => {
    expect(parseThreadDeepLink(url)).toBeNull();
  });
});
