import { RpcResponseError } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { parseActionCatalog } from "../src/data/forgeActionCatalog";
import { parseAuthStart, parseForgeAccounts, parseSubmitToken } from "../src/data/forgeContract";
import { classifyForgeError, ForgeContractViolation } from "../src/data/forgeErrors";
import { sanitizeForgeGlyph } from "../src/data/forgeGlyph";
import { parseFilesPage, parseSubmitOutcome } from "../src/data/forgeMutationContract";
import { parsePullRequestListPage, parsePullRequestOverview } from "../src/data/forgePullRequestContract";
import {
  ARCANUM_GLYPH,
  action,
  arcanumProvider,
  connectedAccount,
  expiredAccount,
  failedFlow,
  filesPage,
  githubProvider,
  hostLoginFlow,
  onboardingAccounts,
  overview91,
  reviewRequestedPage,
} from "./fixtures/forgeWireFixtures";

describe("forge accounts contract", () => {
  it("parses providers, methods, flows and account states without any credential field", () => {
    const snapshot = parseForgeAccounts({
      accounts: [connectedAccount, expiredAccount],
      flows: [hostLoginFlow],
      providers: [githubProvider, arcanumProvider],
    });
    expect(snapshot?.providers.map((provider) => provider.pluginId)).toEqual(["github", "arcanum"]);
    expect(snapshot?.providers[0]?.authMethods.map((method) => method.kind)).toEqual(["linkExisting", "hostLogin", "pasteToken"]);
    expect(snapshot?.accounts.map((account) => account.state)).toEqual(["connected", "expired"]);
    expect(snapshot?.flows[0]?.userCode).toBe("ABCD-1234");
    expect(JSON.stringify(snapshot)).not.toMatch(/token"\s*:/iu);
  });

  it("requires defaultHost on every provider; null means Connect cannot start", () => {
    const snapshot = parseForgeAccounts({
      ...onboardingAccounts,
      providers: [githubProvider, { ...arcanumProvider, defaultHost: null }],
    });
    expect(snapshot?.providers.map((provider) => provider.defaultHost)).toEqual(["github.com", null]);
    const { defaultHost: _omitted, ...withoutHost } = githubProvider;
    expect(parseForgeAccounts({ ...onboardingAccounts, providers: [withoutHost] })).toBeNull();
  });

  it("keeps a failed host login with its reason and requires every flow to name its state", () => {
    const snapshot = parseForgeAccounts({ ...onboardingAccounts, flows: [hostLoginFlow, failedFlow] });
    expect(snapshot?.flows.map((flow) => flow.state)).toEqual(["awaitingUser", "failed"]);
    expect(snapshot?.flows[1]).toMatchObject({ reason: "gh exited before the sign-in finished.", retryable: true });
    expect(parseForgeAccounts({ ...onboardingAccounts, flows: [{ ...failedFlow, state: "lost" }] })).toBeNull();
    const { state: _omitted, ...withoutState } = hostLoginFlow;
    expect(parseForgeAccounts({ ...onboardingAccounts, flows: [withoutState] })).toBeNull();
  });

  it("keeps a safe plugin glyph and replaces an unsafe one with the generic icon", () => {
    const unsafe = { ...arcanumProvider, icon: { glyph: { path: "<script/>", viewBox: "0 0 24 24" }, iconKey: "arcanum" } };
    const snapshot = parseForgeAccounts({ ...onboardingAccounts, providers: [arcanumProvider, unsafe] });
    expect(snapshot?.providers[0]?.icon.glyph?.path).toBe(ARCANUM_GLYPH);
    expect(snapshot?.providers[1]?.icon.glyph).toBeNull();
  });

  it("rejects a snapshot with an unknown account state instead of guessing it", () => {
    expect(parseForgeAccounts({ ...onboardingAccounts, accounts: [{ ...connectedAccount, state: "maybe" }] })).toBeNull();
  });

  it("parses both auth start outcomes and the token-free submitToken result", () => {
    expect(parseAuthStart({ flow: hostLoginFlow, kind: "flow" })).toMatchObject({ kind: "flow" });
    expect(parseAuthStart({ account: connectedAccount, kind: "connected" })).toMatchObject({ kind: "connected" });
    const account = parseSubmitToken({ account: { ...connectedAccount, credentialSource: "savedToken" } });
    expect(account?.credentialSource).toBe("savedToken");
    expect(account).not.toHaveProperty("token");
  });
});

describe("forge glyph sanitizer", () => {
  it("accepts one bounded path of path commands in the fixed box", () => {
    expect(sanitizeForgeGlyph({ path: "M0 0L24 24z", viewBox: "0 0 24 24" })).toEqual({ path: "M0 0L24 24z", viewBox: "0 0 24 24" });
  });

  it.each([
    ["markup", { path: "<path d='M0 0'/>", viewBox: "0 0 24 24" }],
    ["another box", { path: "M0 0", viewBox: "0 0 16 16" }],
    ["no move first", { path: "L0 0", viewBox: "0 0 24 24" }],
    ["url reference", { path: "M0 0 url(#x)", viewBox: "0 0 24 24" }],
    ["over the size cap", { path: `M${"0 ".repeat(3000)}`, viewBox: "0 0 24 24" }],
    ["not an object", "M0 0"],
  ])("drops %s", (_name, glyph) => {
    expect(sanitizeForgeGlyph(glyph)).toBeNull();
  });
});

describe("pull request reads", () => {
  it("keeps a broken account as its own section while others list", () => {
    const page = parsePullRequestListPage(reviewRequestedPage);
    expect(page?.sections.map((section) => [section.account.state, section.rows.length])).toEqual([
      ["connected", 2],
      ["expired", 0],
    ]);
  });

  it("parses the atomic overview with links, local checkout and checks", () => {
    const overview = parsePullRequestOverview(overview91, () => undefined);
    expect(overview?.merge).toEqual({ reason: "1 required check is failing", state: "blocked" });
    expect(overview?.links.map((link) => link.source)).toEqual(["branch", "manual"]);
    expect(overview?.localCheckout?.workspace).toBe("/home/dev/CodeWide");
    expect(overview?.catalog.actions).toHaveLength(overview91.catalog.actions.length);
  });

  it("parses truncated pages and every patch state", () => {
    const page = parseFilesPage(filesPage);
    expect(page?.truncated).toEqual({ shown: 300, total: 1284 });
    expect(page?.files.map((file) => file.patch.state)).toEqual(["present", "tooLarge", "notProvided"]);
    expect(page?.files.map((file) => file.viewed.source)).toEqual(["forge", "forge", "companion"]);
  });

  it("makes partial publication explicit per draft", () => {
    const outcome = parseSubmitOutcome({
      drafts: [
        { agent: "notRequested", draftId: "d1", error: null, pr: "published" },
        { agent: "sent", draftId: "d2", error: null, pr: "published" },
        { agent: "notRequested", draftId: "d4", error: "Line no longer in the diff", pr: "outdated" },
      ],
      reviewUrl: "https://github.com/MrFlashAccount/CodeWide/pull/91#pullrequestreview-1",
      runId: "run-1",
    });
    expect(outcome?.drafts.map((draft) => draft.pr)).toEqual(["published", "published", "outdated"]);
  });
});

describe("action catalog parsing rules", () => {
  it("drops only what the contract says to drop and reports the opaque id", () => {
    const report = vi.fn<(actionId: string) => void>();
    const catalog = parseActionCatalog(
      {
        actions: [
          action("unknown-confirm", { confirm: "maybe" }),
          action("disabled-silent", { availability: { state: "disabled" } }),
          action("strange-input", { input: { label: "Pick", type: "slider" } }),
          action("disabled-reason", { availability: { reason: "Repository does not allow auto-merge", state: "disabled" } }),
          action("future-kind", { kind: "deploy" }),
          action("odd-placement", { placement: "floating" }),
          action("odd-anchor", { anchor: { kind: "sidebar" }, placement: "primary" }),
        ],
        headRevision: "3fa9e12",
      },
      report,
    );
    expect(report.mock.calls.map(([id]) => id)).toEqual(["unknown-confirm", "disabled-silent", "strange-input"]);
    expect(catalog?.actions.map((item) => item.actionId)).toEqual(["disabled-reason", "future-kind", "odd-placement", "odd-anchor"]);
    expect(catalog?.actions.find((item) => item.actionId === "future-kind")?.kind).toBe("extension");
    expect(catalog?.actions.find((item) => item.actionId === "odd-placement")?.placement).toBe("overflow");
    expect(catalog?.actions.find((item) => item.actionId === "odd-anchor")).toMatchObject({ anchor: null, placement: "overflow" });
  });
});

describe("forge error classification", () => {
  it.each([
    [-32_080, "providerUnavailable"],
    [-32_081, "authRequired"],
    [-32_082, "staleHead"],
    [-32_084, "capabilityUnavailable"],
    [-32_085, "invalidGuide"],
    [-32_086, "guideTooLarge"],
    [-32_087, "rateLimited"],
    [-32_088, "conflict"],
    [-32_089, "confirmationRequired"],
    [-32_601, "companionTooOld"],
  ])("maps %i to %s", (code, kind) => {
    expect(classifyForgeError(new RpcResponseError(code, "reason")).kind).toBe(kind);
  });

  it("classifies -32083 by the data kind the companion sends (errors.rs), not by its message", () => {
    const unknown = new RpcResponseError(
      -32_083,
      "The outcome of the earlier attempt is unknown; refresh the pull request",
      { code: -32_083, kind: "outcomeUnknown", runId: "run-7" },
    );
    expect(classifyForgeError(unknown).kind).toBe("outcomeUnknown");
    const refused = new RpcResponseError(-32_083, "Head branch is protected", {
      code: -32_083,
      kind: "forgeRejected",
      reason: "Head branch is protected",
    });
    expect(classifyForgeError(refused).kind).toBe("forgeRejected");
    expect(classifyForgeError(new RpcResponseError(-32_088, "Draft changed", { kind: "notFound" })).kind).toBe("conflict");
  });

  it("keeps a contract violation apart from an unreachable companion", () => {
    expect(classifyForgeError(new ForgeContractViolation("pull request list")).kind).toBe("contractViolation");
    expect(classifyForgeError(new Error("socket closed")).kind).toBe("unreachable");
  });
});
