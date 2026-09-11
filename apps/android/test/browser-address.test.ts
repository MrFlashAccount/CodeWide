import { describe, expect, it } from "vitest";
import { browserAddressKeepsOrigin, resolveBrowserAddress } from "../src/browser/browser-address";

describe("browser address navigation", () => {
  const current = "http://127.0.0.1:43210/app/page?old=1";
  it("keeps the forwarded origin for paths, query edits and fragments", () => {
    expect(resolveBrowserAddress("/api?x=1#result", current)).toBe("http://127.0.0.1:43210/api?x=1#result");
    expect(resolveBrowserAddress("../other", current)).toBe("http://127.0.0.1:43210/other");
    expect(resolveBrowserAddress("?new=2", current)).toBe("http://127.0.0.1:43210/app/page?new=2");
    expect(resolveBrowserAddress("#section", current)).toBe(`${current}#section`);
  });
  it("supports complete addresses, bare domains and local development addresses", () => {
    expect(resolveBrowserAddress(" https://example.com/a?x=1 ", current)).toBe("https://example.com/a?x=1");
    expect(resolveBrowserAddress("example.com/docs", current)).toBe("https://example.com/docs");
    expect(resolveBrowserAddress("localhost:3000", current)).toBe("http://localhost:3000/");
    expect(resolveBrowserAddress("127.0.0.1:5000", current)).toBe("http://127.0.0.1:5000/");
    expect(resolveBrowserAddress("[::1]:3000", current)).toBe("http://[::1]:3000/");
  });
  it("rejects empty or executable input without changing existing page-navigation policy", () => {
    for (const text of ["", "  ", "javascript:alert(1)", "data:text/html,hello", "file:///etc/hosts", "https://", "not an address"]) {
      expect(() => resolveBrowserAddress(text, current)).toThrow();
    }
  });
  it("does not send original tunnel headers to a typed external origin or different port", () => {
    expect(browserAddressKeepsOrigin(current, resolveBrowserAddress("/api", current))).toBe(true);
    expect(browserAddressKeepsOrigin(current, "https://example.com")).toBe(false);
    expect(browserAddressKeepsOrigin(current, "http://127.0.0.1:9999/")).toBe(false);
    expect(browserAddressKeepsOrigin(current, "https://127.0.0.1:43210/")).toBe(false);
  });
});
