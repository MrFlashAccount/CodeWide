import { describe, expect, it } from "vitest";

import { forwardedLoopbackUrl, parseLoopbackLink } from "../src/rendering/loopback-link";

describe("loopback Markdown links", () => {
  it.each([
    ["http://localhost:3000/dashboard?q=one#logs", 3000, "http:", "/dashboard?q=one#logs"],
    ["https://127.0.0.1/api", 443, "https:", "/api"],
    ["http://[::1]:5173/", 5173, "http:", "/"],
  ] as const)("parses %s", (href, remotePort, protocol, suffix) => {
    expect(parseLoopbackLink(href)).toEqual({ remotePort, protocol, suffix });
  });

  it.each([
    "https://example.com:3000/",
    "ftp://localhost:21/",
    "http://user:secret@localhost:3000/",
    "localhost:3000",
    "not a url",
  ])("does not intercept %s", (href) => {
    expect(parseLoopbackLink(href)).toBeNull();
  });

  it("rewrites only the authority and preserves the original route", () => {
    const target = parseLoopbackLink("http://localhost:43191/hello?from=thread#result");
    expect(target).not.toBeNull();
    expect(forwardedLoopbackUrl(target!, {
      id: "forward-1",
      connectionId: "workstation",
      label: "localhost:43191",
      remoteHost: "127.0.0.1",
      remotePort: 43191,
      preferredLocalPort: null,
      localPort: 46210,
      enabled: true,
      status: "live",
      previewUrl: "http://127.0.0.1:46210/",
      error: null,
      updatedAt: 1,
    })).toBe("http://127.0.0.1:46210/hello?from=thread#result");
  });
});
