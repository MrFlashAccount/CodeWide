import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BROWSER_FEEDBACK_BOOTSTRAP } from "../src/features/ports/browser/feedback";

describe("injected element picker", () => {
  it("preserves fetch results and sends only after explicitly arming and selecting", async () => {
    const messages: string[] = [];
    const listeners = new Map<string, (event: unknown) => void>();
    const response = { ok: false, status: 403 };
    const attributes: readonly { name: string }[] = [{ name: "value" }, { name: "class" }];
    class Element {
      readonly tagName = "BUTTON";
      readonly id = "";
      readonly parentElement = null;
      readonly attributes = attributes;
      readonly outerHTML = "<button>Save</button>";
      readonly style = {};
      cloneNode() { return new Element(); }
      querySelectorAll() { return []; }
      matches() { return false; }
      removeAttribute() {}
      remove() {}
      getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 40 }; }
    }
    const window = {
      addEventListener() {},
      fetch: async () => response,
      ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
    };
    class Request { open() {} }
    const context = { window, URL, Element, XMLHttpRequest: Request,
      location: { href: "https://example.com/page?token=hidden" }, innerWidth: 360, innerHeight: 800, devicePixelRatio: 2,
      console: { error() {} },
      document: { addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler), createElement: () => new Element(), documentElement: { appendChild() {} } },
    };
    runInNewContext(BROWSER_FEEDBACK_BOOTSTRAP, context);
    expect(await window.fetch()).toBe(response);
    const click = { target: new Element(), preventDefault() {}, stopImmediatePropagation() {} };
    listeners.get("click")?.(click);
    expect(messages).toHaveLength(0);
    runInNewContext("window.__codewideFeedback.start()", context);
    listeners.get("click")?.(click);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0] ?? "null")).toMatchObject({ type: "codewide.elementSelected", url: "https://example.com/page", selector: "button", html: "<button>Save</button>" });
    expect(messages[0]).not.toContain("hidden");
    listeners.get("click")?.(click);
    expect(messages).toHaveLength(1);
  });
});
