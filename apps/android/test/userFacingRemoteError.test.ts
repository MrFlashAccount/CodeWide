import { describe, expect, it } from "vitest";

import { userFacingRemoteError } from "../src/data/userFacingRemoteError";

describe("userFacingRemoteError", () => {
  it.each([
    "This thread is open elsewhere. Close it there and retry resume to continue.",
    "This conversation is open in another app",
  ])("rewrites the conversation ownership diagnostic: %s", (message) => {
    expect(userFacingRemoteError(message)).toEqual({
      kind: "conversationOpenElsewhere",
      message: "This conversation is open in another app. Close it there, then try again here.",
    });
  });

  it("preserves unrelated server errors", () => {
    expect(userFacingRemoteError("Request rejected")).toEqual({
      kind: "generic",
      message: "Request rejected",
    });
  });
});
