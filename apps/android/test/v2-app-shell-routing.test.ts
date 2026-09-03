import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { savedServerId, threadId } from "../src/v2/domain/ids";
import type { SavedServer } from "../src/v2/domain/savedServer";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { selectRecoveryServer } from "../src/v2/features/diagnostics/renderRecoveryServer";
import {
  itemOutputDestination,
  pairingDestination,
  reviewChangesDestination,
  reviewResponseDestination,
  reviewStartDestination,
} from "../src/v2/features/navigation/routeDestinations";
import {
  pairingDeepLinkRouteParam,
  qualifiedThreadDeepLinkRouteParams,
} from "../src/v2/features/navigation/routeParams";

const owner = qualifiedThread(savedServerId("server/one"), threadId("thread:7"));

describe("V2 app shell routing", () => {
  it("accepts canonical and legacy external thread identities but rejects disagreement", () => {
    expect(
      qualifiedThreadDeepLinkRouteParams({
        savedServerId: "server/one",
        threadId: "thread:7",
      }),
    ).toEqual(owner);
    expect(
      qualifiedThreadDeepLinkRouteParams({ connectionId: "server/one", threadId: "thread:7" }),
    ).toEqual(owner);
    expect(
      qualifiedThreadDeepLinkRouteParams({
        connectionId: "server/one",
        savedServerId: "server/one",
        threadId: "thread:7",
      }),
    ).toEqual(owner);
    expect(
      qualifiedThreadDeepLinkRouteParams({
        connectionId: "another-server",
        savedServerId: "server/one",
        threadId: "thread:7",
      }),
    ).toBeNull();
  });

  it("reconstructs a bounded pairing link from decoded Expo Router params", () => {
    const pairingCode = pairingDeepLinkRouteParam({
      e: "wss://host.example/v1/sync",
      i: "🖥️",
      n: "Home server",
      p: `sha256/${"a".repeat(43)}=`,
      t: "token",
      v: "1",
      x: "123456",
      y: "234567",
    });
    expect(pairingCode).not.toBeNull();
    const url = new URL(pairingCode ?? "");
    expect(url.hostname).toBe("pair");
    expect(url.searchParams.get("e")).toBe("wss://host.example/v1/sync");
    expect(url.searchParams.get("n")).toBe("Home server");
    expect(pairingDestination(pairingCode ?? "")).toEqual({
      params: { pairingCode },
      pathname: "/settings/servers/new",
    });
  });

  it("rejects ambiguous or oversized public deep-link params", () => {
    expect(
      qualifiedThreadDeepLinkRouteParams({ savedServerId: ["one", "two"], threadId: "thread" }),
    ).toBeNull();
    expect(
      qualifiedThreadDeepLinkRouteParams({ savedServerId: "server\0one", threadId: "thread" }),
    ).toBeNull();
    expect(
      pairingDeepLinkRouteParam({
        e: "wss://host.example/v1/sync",
        i: "🖥️",
        n: "Home server",
        p: `sha256/${"a".repeat(43)}=`,
        t: "x".repeat(4_096),
        v: "1",
        x: "123456",
      }),
    ).toBeNull();
  });

  it("builds typed review destinations with mode-specific params", () => {
    expect(reviewStartDestination(owner)).toEqual({
      params: { mode: "start", savedServerId: "server/one", threadId: "thread:7" },
      pathname: "/servers/[savedServerId]/threads/[threadId]/review",
    });
    expect(reviewChangesDestination(owner, "staged").params).toEqual({
      mode: "changes",
      savedServerId: "server/one",
      scope: "staged",
      threadId: "thread:7",
    });
    expect(reviewChangesDestination(owner).params).not.toHaveProperty("scope");
    expect(reviewResponseDestination(owner, "turn-1", "item-1").params).toEqual({
      itemId: "item-1",
      mode: "response",
      savedServerId: "server/one",
      threadId: "thread:7",
      turnId: "turn-1",
    });
  });

  it("binds a full-output route to the owning server, thread, turn, and item", () => {
    expect(itemOutputDestination(owner, "turn-1", "item-1")).toEqual({
      params: {
        itemId: "item-1",
        savedServerId: "server/one",
        threadId: "thread:7",
        turnId: "turn-1",
      },
      pathname: "/servers/[savedServerId]/threads/[threadId]/items/[itemId]/output",
    });
  });

  it("anchors modal URLs over the workspace and emits canonical notification identities", () => {
    const rootLayout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
    const service = readFileSync(
      new URL(
        "../android/app/src/main/java/dev/codewide/app/remote/CodexConnectionService.kt",
        import.meta.url,
      ),
      "utf8",
    );
    expect(rootLayout).toContain('anchor: "(workspace)"');
    expect(rootLayout).toContain('presentation: "transparentModal"');
    expect(service.match(/appendQueryParameter\("savedServerId", connectionId\)/g)).toHaveLength(2);
    expect(service.match(/appendQueryParameter\("connectionId", connectionId\)/g)).toHaveLength(2);
  });

  it("keeps zero-server entry inside the aggregate shell and makes public aliases V2-aware", () => {
    const serverList = readFileSync(
      new URL("../src/v2/features/serverList/ServerListScreen.tsx", import.meta.url),
      "utf8",
    );
    const pairRoute = readFileSync(new URL("../app/pair.tsx", import.meta.url), "utf8");
    const threadRoute = readFileSync(new URL("../app/thread.tsx", import.meta.url), "utf8");
    expect(serverList).toContain("<ThreadCatalogWorkspaceView");
    expect(serverList).toContain("router.push(newSavedServerDestination())");
    expect(serverList).not.toContain("<Redirect");
    expect(pairRoute).toContain("pairingDestination(pairingCode)");
    expect(threadRoute).toContain("qualifiedThreadDeepLinkRouteParams");
    expect(pairRoute).not.toContain("Temporary legacy-only alias");
    expect(threadRoute).not.toContain("Temporary legacy-only alias");
  });

  it("keeps diagnostics generation-scoped and render recovery inside V2 route boundaries", () => {
    const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
    const application = readFileSync(
      new URL("../src/v2/V2Application.tsx", import.meta.url),
      "utf8",
    );
    const settings = readFileSync(
      new URL("../app/(modal)/settings/index.tsx", import.meta.url),
      "utf8",
    );
    const workspace = readFileSync(
      new URL("../app/(workspace)/_layout.tsx", import.meta.url),
      "utf8",
    );
    const savedServer = readFileSync(
      new URL("../app/(workspace)/servers/[savedServerId]/_layout.tsx", import.meta.url),
      "utf8",
    );
    const thread = readFileSync(
      new URL(
        "../app/(workspace)/servers/[savedServerId]/threads/[threadId]/_layout.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const modal = readFileSync(new URL("../app/(modal)/_layout.tsx", import.meta.url), "utf8");
    expect(root).toContain("UiGenerationDiagnosticsHost");
    expect(application).toContain("V2RenderRecoveryProvider");
    expect(settings).toContain("V2PerformanceDiagnostics");
    expect(workspace).toContain("RecoverableRenderBoundary");
    expect(savedServer).toContain('label="Saved server route"');
    expect(thread).toContain('label="Thread route"');
    expect(modal).toContain('scope="dialog"');
    expect(modal).toContain("onDismiss={dismiss}");
  });

  it("uses an explicit repair server and never collapses All Servers implicitly", () => {
    const servers: SavedServer[] = [
      savedServer("disabled", false),
      savedServer("fallback", true),
      savedServer("preferred", true),
    ];
    expect(selectRecoveryServer(servers, savedServerId("preferred"))?.id).toBe("preferred");
    expect(selectRecoveryServer(servers, savedServerId("disabled"))).toBeNull();
    expect(selectRecoveryServer(servers, null)).toBeNull();
    expect(selectRecoveryServer([savedServer("only", true)], null)?.id).toBe("only");
    expect(selectRecoveryServer([savedServer("disabled", false)], null)).toBeNull();
  });
});

function savedServer(id: string, enabled: boolean): SavedServer {
  return {
    displayName: id,
    emoji: "server",
    enabled,
    endpoint: `wss://${id}.example`,
    id: savedServerId(id),
  };
}
