/**
 * Claude proxy environment boundary and query-option composition.
 */

import { describe, expect, it } from "vitest";
import type { AgentSdk } from "../src/claude/sdkModule.js";
import { loadAgentSdk } from "../src/claude/sdkModule.js";
import {
  proxyEnvironmentFromResolvedSettings,
  resolveUserProxyEnvironment,
} from "../src/claude/sdkProxyEnvironment.js";
import { sdkQueryOptions } from "../src/claude/sdkRuntime.js";
import { profileOptions, type ProfileId } from "../src/permissions/profiles.js";

const PROFILES: readonly ProfileId[] = [
  ":read-only",
  ":workspace",
  ":full-access",
  ":danger-full-access",
];

describe("Claude proxy environment", () => {
  it("asks the SDK for only user settings and returns standard effective proxy variables", async () => {
    const requests: unknown[] = [];
    const sdk = {
      resolveSettings: async (options) => {
        requests.push(options);
        return {
          effective: {
            env: {
              ANTHROPIC_AUTH_TOKEN: "must-not-cross",
              HTTPS_PROXY: "http://proxy.example",
              HTTP_PROXY: "http://proxy.example",
              NO_PROXY: "localhost",
              UNRELATED: "must-not-cross",
              http_proxy: "http://lower-proxy.example",
              https_proxy: "http://lower-proxy.example",
              no_proxy: "localhost",
            },
          },
          provenance: {},
          sources: [],
        };
      },
    } satisfies Pick<AgentSdk, "resolveSettings">;

    await expect(resolveUserProxyEnvironment(sdk)).resolves.toEqual({
      HTTPS_PROXY: "http://proxy.example",
      HTTP_PROXY: "http://proxy.example",
      NO_PROXY: "localhost",
      http_proxy: "http://lower-proxy.example",
      https_proxy: "http://lower-proxy.example",
      no_proxy: "localhost",
    });
    expect(requests).toEqual([{ settingSources: ["user"] }]);
  });

  it("treats a missing environment as no overrides", () => {
    expect(proxyEnvironmentFromResolvedSettings({ effective: {} })).toEqual({});
  });

  it.each([
    null,
    {},
    { effective: null },
    { effective: { env: null } },
    { effective: { env: [] } },
    { effective: { env: new Date() } },
    { effective: { env: { HTTP_PROXY: 42 } } },
    { effective: { env: { no_proxy: false } } },
  ])("rejects an unexpected selected proxy shape", (value) => {
    expect(() => proxyEnvironmentFromResolvedSettings(value)).toThrow(/resolved Claude/u);
  });

  it("ignores unrelated entries even when their runtime values are invalid", () => {
    expect(
      proxyEnvironmentFromResolvedSettings({
        effective: { env: { ANTHROPIC_AUTH_TOKEN: 42, UNRELATED: null } },
      }),
    ).toEqual({});
  });

  it("requires the SDK settings resolver in the loaded module contract", async () => {
    expect((await loadAgentSdk(null)).resolveSettings).toBeTypeOf("function");
  });
});

describe("SDK query proxy environment", () => {
  it("merges configured proxy values into every profile without widening read-only settings", async () => {
    const sdk = await loadAgentSdk(null);
    const proxyEnvironment = {
      HTTPS_PROXY: "http://proxy.example",
      HTTP_PROXY: "http://proxy.example",
      NO_PROXY: "localhost",
    };
    const queryOptions = PROFILES.map((profile) =>
      sdkQueryOptions(
        sdk,
        { claudeExecutable: "/claude", proxyEnvironment },
        {
          canUseTool: async (request) => ({
            behavior: "deny",
            interrupt: false,
            message: "denied",
            toolUseID: request.toolUseId,
          }),
          clientTools: null,
          cwd: "/workspace",
          effort: null,
          identity: { sessionId: "session", type: "new" },
          model: "default",
          profile: profileOptions(profile),
        },
      ),
    );

    for (const options of queryOptions) {
      expect(options.env).toMatchObject(proxyEnvironment);
    }
    expect(queryOptions[0]).toMatchObject({
      mcpServers: {},
      permissionMode: "default",
      settingSources: [],
      strictMcpConfig: true,
      tools: ["Read", "Glob", "Grep", "LS"],
    });
    expect(queryOptions[0]).not.toHaveProperty("allowDangerouslySkipPermissions");
    expect(queryOptions[1]).toMatchObject({
      permissionMode: "acceptEdits",
      settingSources: ["user", "project", "local"],
    });
  });
});
