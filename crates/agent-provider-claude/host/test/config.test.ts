/** Launch arguments of the host process. */

import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const base = ["--claude-executable", "/usr/bin/claude", "--state-directory", "/state"];

describe("host launch arguments", () => {
  it("takes the Agent SDK the companion installed, else the installed package", () => {
    expect(parseConfig([...base, "--agent-sdk", "/sdk/0.3.295/sdk.mjs"])).toMatchObject({
      config: { agentSdk: "/sdk/0.3.295/sdk.mjs" },
      status: "ok",
    });
    expect(parseConfig(base)).toMatchObject({ config: { agentSdk: null }, status: "ok" });
    expect(parseConfig([...base, "--agent-sdk", "sdk.mjs"])).toEqual({
      error: "--agent-sdk must be an absolute path",
      status: "error",
    });
  });
});
