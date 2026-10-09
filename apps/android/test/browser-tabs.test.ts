import { afterEach, describe, expect, it } from "vitest";
import { BrowserTabsModel, browserTabsInOrder } from "../src/services/browser/browserTabsModel";
import { browserTabCatalog } from "../src/services/browser/browserTabCatalog";
import { browserRouteSessions } from "../src/services/browser/browserRouteSession";
import { disposeAllRouteSessions } from "../src/services/routeSessionPolicy";
import {
  v1ThreadRouteParams,
  workspaceRouteSessionOwner,
} from "../src/services/threads/threadRouteParams";
import {
  browserAllowedPageUrl,
  browserNativeTarget,
  browserPageUrl,
  browserTabLabel,
} from "../src/features/browser/browserNavigationPolicy";

function thread(connectionId: string, threadId: string) {
  const parsed = v1ThreadRouteParams({ connectionId, threadId });
  if (parsed.status !== "valid") throw new Error("Invalid test identity");
  return parsed.value;
}
function selectedPage(tabs: BrowserTabsModel) {
  const state = tabs.state$.peek();
  return state.kind === "tabs" ? state.selected : null;
}
const destination = { title: "Example", url: "https://example.com/" };
afterEach(disposeAllRouteSessions);

describe("chat browser tabs", () => {
  it("keeps distinct pages, selects without replacement, and closes only the requested page", () => {
    const tabs = new BrowserTabsModel();
    const first = tabs.open(destination);
    const second = tabs.open(destination);
    const third = tabs.open({ title: "Third", url: "https://third.example/" });
    tabs.select(second.id);
    expect(selectedPage(tabs)).toBe(second);
    expect(Array.from(browserTabsInOrder(tabs.state$.peek()))).toEqual([first, second, third]);
    first.publish({ loading: false, title: "Redirected", url: "https://example.com/redirect" });
    expect(first.metadata$.peek().url).toBe("https://example.com/redirect");
    expect(first.destination?.url).toBe(destination.url);
    tabs.close(first.id);
    expect(selectedPage(tabs)).toBe(second);
    tabs.close(second.id);
    expect(selectedPage(tabs)).toBe(third);
    tabs.close(third.id);
    const home = selectedPage(tabs);
    expect(home?.source$.peek()).toEqual({ kind: "home" });
    expect(home?.id).not.toBe(third.id);
    expect(Array.from(browserTabsInOrder(tabs.state$.peek()))).toEqual([home]);
  });

  it("chooses the previous neighbour when closing the final selected page", () => {
    const tabs = new BrowserTabsModel();
    const first = tabs.open(destination);
    const second = tabs.open(destination);
    tabs.close(second.id);
    expect(selectedPage(tabs)).toBe(first);
  });

  it("keeps the sole Home open, allows extra Home tabs to close and clears on teardown", () => {
    const tabs = new BrowserTabsModel();
    tabs.ensureHome();
    const home = selectedPage(tabs);
    if (home === null) throw new Error("Expected Home");
    expect(tabs.canClose(home.id)).toBe(false);
    tabs.close(home.id);
    expect(selectedPage(tabs)).toBe(home);
    const extra = tabs.openHome();
    expect(tabs.canClose(extra.id)).toBe(true);
    tabs.close(extra.id);
    expect(selectedPage(tabs)).toBe(home);
    home.openPageFromHome(destination);
    expect(tabs.canClose(home.id)).toBe(true);
    tabs.close(home.id);
    expect(selectedPage(tabs)?.source$.peek()).toEqual({ kind: "home" });
    expect(selectedPage(tabs)?.id.value).not.toBe(home.id.value);
    tabs.clear();
    expect(tabs.state$.peek()).toEqual({ kind: "empty" });
  });

  it("does not silently evict tabs or impose an arbitrary eight-tab admission limit", () => {
    const tabs = new BrowserTabsModel();
    const opened = Array.from({ length: 12 }, () => tabs.open(destination));
    expect(Array.from(browserTabsInOrder(tabs.state$.peek()))).toEqual(opened);
  });

  it("isolates identical thread IDs on different servers and chats in the same project", () => {
    const a = browserTabCatalog.forThread(thread("server-a", "chat"));
    a.open(destination);
    expect(browserTabCatalog.forThread(thread("server-a", "chat"))).toBe(a);
    expect(browserTabCatalog.forThread(thread("server-b", "chat")).state$.peek().kind).toBe(
      "empty",
    );
    expect(browserTabCatalog.forThread(thread("server-a", "other-chat")).state$.peek().kind).toBe(
      "empty",
    );
  });

  it("keeps the catalog and selected page after dismissing its opaque presentation", () => {
    const identity = thread("server", "chat");
    const session = browserRouteSessions.open(workspaceRouteSessionOwner, destination, identity);
    const selected = session.tabs.state$.peek();
    browserRouteSessions.close(session.id);
    expect(browserRouteSessions.get(session.id, workspaceRouteSessionOwner)).toBeNull();
    const reopened = browserRouteSessions.openTabs(workspaceRouteSessionOwner, identity);
    expect(reopened.tabs).toBe(session.tabs);
    expect(reopened.tabs.state$.peek()).toBe(selected);
    disposeAllRouteSessions();
    expect(reopened.tabs.state$.peek().kind).toBe("empty");
  });
});

describe("browser navigation boundary", () => {
  it.each([
    "intent://app",
    "javascript:alert(1)",
    "file:///secret",
    "data:text/html,hello",
    "https://user:secret@example.com/",
  ])("rejects %s without OS navigation", (url) => {
    expect(browserPageUrl(url)).toBeNull();
  });
  it("accepts ordinary HTTP destinations and keeps private query values out of tab labels", () => {
    expect(browserPageUrl("http://127.0.0.1:4000/page")).toBe("http://127.0.0.1:4000/page");
    expect(browserTabLabel("https://example.com/page?token=secret#private")).toBe("example.com");
    expect(browserTabLabel("about:blank")).toBe("New tab");
    expect(browserNativeTarget({ target: 17 })).toBe(17);
    expect(browserNativeTarget({ target: "17" })).toBeNull();
  });
});

it("respects the same explicit origin policy for normal URLs and popup admission", () => {
  expect(browserAllowedPageUrl("https://allowed.example/page", ["https://allowed.example"])).toBe(
    "https://allowed.example/page",
  );
  expect(
    browserAllowedPageUrl("https://other.example/page", ["https://allowed.example"]),
  ).toBeNull();
  expect(browserAllowedPageUrl("https://other.example/page", ["https://*"])).toBe(
    "https://other.example/page",
  );
});

it("keeps Home separate from network pages and admits its first page exactly once", () => {
  const tabs = new BrowserTabsModel();
  const home = tabs.openHome();
  expect(home.source$.peek()).toEqual({ kind: "home" });
  expect(home.destination).toBeNull();
  home.openPageFromHome(destination);
  expect(home.source$.peek()).toEqual({ destination, kind: "page" });
  home.openPageFromHome({ title: "Other", url: "https://other.example/" });
  expect(home.destination).toBe(destination);
  expect(selectedPage(tabs)?.id).toBe(home.id);
});
