import { describe, expect, it, vi } from "vitest";

import {
  createLocalhostBrowserHandler,
  createLocalhostBrowserSession,
  parseLocalhostTarget,
  tunnelSourcePath,
  type LocalhostTunnelPort,
} from "../src/v2/application/ports/localhostBrowser";

describe("V2 localhost browser links", () => {
  it("recognizes only explicit loopback URLs and preserves the normalized suffix", () => {
    expect(parseLocalhostTarget("http://localhost:3000/a/../b?q=1#result")).toEqual({
      label: "localhost:3000",
      port: 3_000,
      suffix: "b?q=1#result",
    });
    expect(parseLocalhostTarget("https://127.0.0.1:8443/health")).toEqual({
      label: "localhost:8443",
      port: 8_443,
      suffix: "health",
    });
    expect(parseLocalhostTarget("http://[::1]:8080/inspect")).toEqual({
      label: "localhost:8080",
      port: 8_080,
      suffix: "inspect",
    });
    expect(parseLocalhostTarget("https://example.com:3000/private")).toBeNull();
    expect(parseLocalhostTarget("http://localhost/path")).toBeNull();
  });

  it("creates a bounded server tunnel and carries the original path into preview", async () => {
    const createTunnel = vi.fn<LocalhostTunnelPort["createTunnel"]>().mockResolvedValue({
      basePath: "/v2/tunnels/tunnel-1/",
      expiresAt: 12_345,
      id: "tunnel-1",
    });

    const session = await createLocalhostBrowserSession(
      { createTunnel },
      "http://localhost:3000/dashboard?tab=live#top",
      900,
    );

    expect(createTunnel).toHaveBeenCalledWith(3_000, 900);
    expect(session).toEqual({
      expiresAt: 12_345,
      label: "localhost:3000",
      port: 3_000,
      sourcePath: "/v2/tunnels/tunnel-1/dashboard?tab=live#top",
      suffix: "dashboard?tab=live#top",
      tunnelId: "tunnel-1",
    });
  });

  it("exposes a markdown-compatible handler without consuming remote links", async () => {
    const navigate = vi.fn();
    const createTunnel = vi.fn<LocalhostTunnelPort["createTunnel"]>().mockResolvedValue({
      basePath: "/v2/tunnels/tunnel-2/",
      expiresAt: 44,
      id: "tunnel-2",
    });
    const handle = createLocalhostBrowserHandler({ navigate, ports: { createTunnel } });

    await expect(handle("https://example.com:3000")).resolves.toBe(false);
    await expect(handle("http://localhost:3000/docs")).resolves.toBe(true);
    expect(createTunnel).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: "/v2/tunnels/tunnel-2/docs" }),
    );
    expect(tunnelSourcePath("tunnel/unsafe", "docs")).toBe(
      "/v2/tunnels/tunnel%2Funsafe/docs",
    );
  });

  it("rejects invalid tunnel TTL before touching transport", async () => {
    const createTunnel = vi.fn<LocalhostTunnelPort["createTunnel"]>();
    await expect(
      createLocalhostBrowserSession({ createTunnel }, "http://localhost:3000", 29),
    ).rejects.toThrow("TTL must be between 30 and 3600 seconds");
    expect(createTunnel).not.toHaveBeenCalled();
  });
});
