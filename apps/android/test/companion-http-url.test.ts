import { describe, expect, it } from "vitest";
import { companionHttpUrl } from "../src/data/companion-http-url";

describe("Companion HTTP URL", () => {
  it.each([
    ["wss://host.test", "/v1/files", "https://host.test/v1/files"],
    ["ws://[::1]:8080/lease/capability/", "/preview", "http://[::1]:8080/lease/capability/preview"],
    ["http://127.0.0.1:8080/capability///?old=1#old", "/file", "http://127.0.0.1:8080/capability/file"],
    ["https://user:pass@host.test/base", "/file", "https://user:pass@host.test/base/file"],
    ["https://host.test", "//other.test/file", "https://host.test//other.test/file"],
    ["https://host.test/base", "/a?b#c", "https://host.test/base/a%3Fb%23c"],
    ["https://host.test/base", "/отчёт%20сессии.md", "https://host.test/base/%D0%BE%D1%82%D1%87%D1%91%D1%82%20%D1%81%D0%B5%D1%81%D1%81%D0%B8%D0%B8.md"],
  ])("preserves the authority and capability path for %s + %s", (endpoint, path, expected) => {
    expect(companionHttpUrl(endpoint, path)).toBe(expected);
  });

  it("requires an absolute request path", () => {
    expect(() => companionHttpUrl("https://host.test", "file")).toThrow("path must be absolute");
  });
});
