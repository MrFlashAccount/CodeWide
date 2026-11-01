import { RpcResponseError } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { parseActionCatalog } from "../src/data/forgeActionCatalog";
import { parseAuthStart, parseForgeAccounts, parseSubmitToken } from "../src/data/forgeContract";
import { classifyForgeError, ForgeContractViolation } from "../src/data/forgeErrors";
import {
  parseActionRun,
  parseFilesPage,
  parseReviewChatEnsure,
  parseScenarioStart,
  parseSubmitOutcome,
} from "../src/data/forgeMutationContract";
import { providerIcon } from "../src/data/forgeProviderIcon";
import {
  parsePullRequestLinks,
  parsePullRequestListPage,
  parsePullRequestOverview,
} from "../src/data/forgePullRequestContract";
import {
  ARCANUM_GLYPH,
  GITHUB_ICON_PNG,
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
  it("reads provider installation and the account catalog switch, defaulting for an older Companion", () => {
    const snapshot = parseForgeAccounts({
      accounts: [{ ...connectedAccount, catalogEnabled: false }, expiredAccount],
      flows: [],
      providers: [
        { ...githubProvider, installation: { state: "installed" } },
        {
          ...arcanumProvider,
          installation: { reason: "The provider's plugin is not installed", state: "missing" },
        },
        {
          ...arcanumProvider,
          installation: { reason: "It exited", state: "failed" },
          pluginId: "broken",
        },
        { ...arcanumProvider, pluginId: "older" },
      ],
    });
    expect(snapshot?.providers.map((provider) => provider.installation)).toEqual([
      { state: "installed" },
      { reason: "The provider's plugin is not installed", state: "missing" },
      { reason: "It exited", state: "failed" },
      { state: "unknown" },
    ]);
    expect(snapshot?.accounts.map((account) => account.catalogEnabled)).toEqual([false, null]);
    expect(
      parseForgeAccounts({
        ...onboardingAccounts,
        providers: [{ ...githubProvider, installation: { state: "missing" } }],
      }),
    ).toBeNull();
  });

  it("parses providers, methods, flows and account states without any credential field", () => {
    const snapshot = parseForgeAccounts({
      accounts: [connectedAccount, expiredAccount],
      flows: [hostLoginFlow],
      providers: [githubProvider, arcanumProvider],
    });
    expect(snapshot?.providers.map((provider) => provider.pluginId)).toEqual(["github", "arcanum"]);
    expect(snapshot?.providers[0]?.authMethods.map((method) => method.kind)).toEqual([
      "linkExisting",
      "hostLogin",
      "pasteToken",
    ]);
    expect(snapshot?.accounts.map((account) => account.state)).toEqual(["connected", "expired"]);
    expect(snapshot?.flows[0]?.userCode).toBe("ABCD-1234");
    expect(JSON.stringify(snapshot)).not.toMatch(/token"\s*:/iu);
  });

  it("requires defaultHost on every provider; null means Connect cannot start", () => {
    const snapshot = parseForgeAccounts({
      ...onboardingAccounts,
      providers: [githubProvider, { ...arcanumProvider, defaultHost: null }],
    });
    expect(snapshot?.providers.map((provider) => provider.defaultHost)).toEqual([
      "github.com",
      null,
    ]);
    const { defaultHost: _omitted, ...withoutHost } = githubProvider;
    expect(parseForgeAccounts({ ...onboardingAccounts, providers: [withoutHost] })).toBeNull();
  });

  it("keeps a failed host login with its reason and requires every flow to name its state", () => {
    const snapshot = parseForgeAccounts({
      ...onboardingAccounts,
      flows: [hostLoginFlow, failedFlow],
    });
    expect(snapshot?.flows.map((flow) => flow.state)).toEqual(["awaitingUser", "failed"]);
    expect(snapshot?.flows[1]).toMatchObject({
      reason: "gh exited before the sign-in finished.",
      retryable: true,
    });
    expect(
      parseForgeAccounts({ ...onboardingAccounts, flows: [{ ...failedFlow, state: "lost" }] }),
    ).toBeNull();
    const { state: _omitted, ...withoutState } = hostLoginFlow;
    expect(parseForgeAccounts({ ...onboardingAccounts, flows: [withoutState] })).toBeNull();
  });

  it("keeps each plugin icon and reads a legacy or unsafe icon as the neutral one", () => {
    const legacy = {
      ...arcanumProvider,
      icon: { glyph: { path: ARCANUM_GLYPH, viewBox: "0 0 24 24" }, iconKey: "arcanum" },
    };
    const unsafe = {
      ...arcanumProvider,
      icon: { kind: "glyph", path: "<script/>", viewBox: "0 0 24 24" },
    };
    const { icon: _omitted, ...missing } = arcanumProvider;
    const snapshot = parseForgeAccounts({
      ...onboardingAccounts,
      providers: [arcanumProvider, githubProvider, legacy, unsafe, missing],
    });
    expect(snapshot?.providers.map((provider) => provider.icon)).toEqual([
      { kind: "glyph", path: ARCANUM_GLYPH, viewBox: "0 0 24 24" },
      { dataBase64: GITHUB_ICON_PNG, kind: "image", mimeType: "image/png" },
      null,
      null,
      null,
    ]);
  });

  it("rejects a snapshot with an unknown account state instead of guessing it", () => {
    expect(
      parseForgeAccounts({
        ...onboardingAccounts,
        accounts: [{ ...connectedAccount, state: "maybe" }],
      }),
    ).toBeNull();
  });

  it("parses both auth start outcomes and the token-free submitToken result", () => {
    expect(parseAuthStart({ flow: hostLoginFlow, kind: "flow" })).toMatchObject({ kind: "flow" });
    expect(parseAuthStart({ account: connectedAccount, kind: "connected" })).toMatchObject({
      kind: "connected",
    });
    const account = parseSubmitToken({
      account: { ...connectedAccount, credentialSource: "savedToken" },
    });
    expect(account?.credentialSource).toBe("savedToken");
    expect(account).not.toHaveProperty("token");
  });
});

describe("provider icon decoder", () => {
  it("keeps a bounded glyph in any integer box up to 1024", () => {
    expect(providerIcon({ kind: "glyph", path: "M0 0L48 16z", viewBox: "0 0 48 16" })).toEqual({
      kind: "glyph",
      path: "M0 0L48 16z",
      viewBox: "0 0 48 16",
    });
  });

  it.each(["image/png", "image/webp", "image/svg+xml"])("keeps a bounded %s image", (mimeType) => {
    expect(providerIcon({ dataBase64: GITHUB_ICON_PNG, kind: "image", mimeType })).toEqual({
      dataBase64: GITHUB_ICON_PNG,
      kind: "image",
      mimeType,
    });
  });

  it("keeps an image of exactly 64 KiB and drops one byte more", () => {
    const encode = (bytes: number): string => Buffer.alloc(bytes, 7).toString("base64");
    const image = (bytes: number) => ({
      dataBase64: encode(bytes),
      kind: "image",
      mimeType: "image/png",
    });
    expect(providerIcon(image(64 * 1024))).not.toBeNull();
    expect(providerIcon(image(64 * 1024 + 1))).toBeNull();
  });

  it.each([
    ["a legacy icon", { glyph: { path: "M0 0", viewBox: "0 0 24 24" }, iconKey: "github" }],
    ["an unknown kind", { kind: "font", name: "github" }],
    ["markup as a path", { kind: "glyph", path: "<path d='M0 0'/>", viewBox: "0 0 24 24" }],
    ["a path not starting with a move", { kind: "glyph", path: "L0 0", viewBox: "0 0 24 24" }],
    ["a url reference", { kind: "glyph", path: "M0 0 url(#x)", viewBox: "0 0 24 24" }],
    ["a path over 4 KiB", { kind: "glyph", path: `M${"0 ".repeat(3000)}`, viewBox: "0 0 24 24" }],
    ["an offset box", { kind: "glyph", path: "M0 0", viewBox: "1 0 24 24" }],
    ["a zero box", { kind: "glyph", path: "M0 0", viewBox: "0 0 0 24" }],
    ["a box over 1024", { kind: "glyph", path: "M0 0", viewBox: "0 0 1025 24" }],
    ["a fractional box", { kind: "glyph", path: "M0 0", viewBox: "0 0 24.5 24" }],
    [
      "an unsupported mime type",
      { dataBase64: GITHUB_ICON_PNG, kind: "image", mimeType: "image/gif" },
    ],
    ["url-safe base64", { dataBase64: "ab-_", kind: "image", mimeType: "image/png" }],
    ["unpadded base64", { dataBase64: "abc", kind: "image", mimeType: "image/png" }],
    ["empty data", { dataBase64: "", kind: "image", mimeType: "image/png" }],
    [
      "a data uri",
      {
        dataBase64: `data:image/png;base64,${GITHUB_ICON_PNG}`,
        kind: "image",
        mimeType: "image/png",
      },
    ],
    ["a string", "M0 0"],
    ["null", null],
  ])("reads %s as the neutral icon", (_name, icon) => {
    expect(providerIcon(icon)).toBeNull();
  });
});

describe("pull request links read", () => {
  const badge = (pluginId: string | undefined, number: string) => ({
    number,
    ...(pluginId === undefined ? {} : { pluginId }),
    pullRequest: `fpr1.${number}`,
    state: "open",
  });

  it("resolves each badge icon from its provider and shares it between badges", () => {
    const links = parsePullRequestLinks({
      providerIcons: {
        arcanum: arcanumProvider.icon,
        broken: { glyph: null, iconKey: "broken" },
        github: githubProvider.icon,
      },
      threads: [
        {
          pullRequests: [badge("github", "1"), badge("arcanum", "2"), badge("broken", "3")],
          threadId: "thread-a",
        },
        { pullRequests: [badge("github", "4"), badge("unknown", "5")], threadId: "thread-b" },
      ],
    });
    const a = links?.["thread-a"] ?? [];
    const b = links?.["thread-b"] ?? [];
    expect(a.map((entry) => entry.icon?.kind ?? null)).toEqual(["image", "glyph", null]);
    expect(b.map((entry) => entry.icon?.kind ?? null)).toEqual(["image", null]);
    expect(b[0]?.icon).toBe(a[0]?.icon);
  });

  it("reads badges of an older Companion with neutral icons", () => {
    const links = parsePullRequestLinks({
      threads: [
        { pullRequests: [{ ...badge(undefined, "7"), icon: githubProvider.icon }], threadId: "t" },
      ],
    });
    expect(links?.["t"]?.map((entry) => [entry.number, entry.icon])).toEqual([["7", null]]);
  });
});

describe("pull request reads", () => {
  it("keeps a broken account as its own section while others list", () => {
    const page = parsePullRequestListPage(reviewRequestedPage);
    expect(page?.sections.map((section) => [section.account.state, section.rows.length])).toEqual([
      ["connected", 2],
      ["expired", 0],
    ]);
    expect(page?.sections[0]?.rows[0]?.attention).toEqual({
      revision: "a".repeat(64),
      state: "new",
    });
  });

  it("parses the atomic overview with links, local checkout and checks", () => {
    const overview = parsePullRequestOverview(overview91, () => undefined);
    expect(overview?.merge).toEqual({ reason: "1 required check is failing", state: "blocked" });
    expect(overview?.links.map((link) => link.source)).toEqual(["branch", "manual"]);
    expect(overview?.localCheckout?.workspace).toBe("/home/dev/CodeWide");
    expect(overview?.catalog.actions).toHaveLength(overview91.catalog.actions.length);
    expect(overview?.attention).toEqual({ revision: "a".repeat(64), state: "new" });
  });

  it("rejects malformed attention revisions instead of treating them as unread", () => {
    const firstSection = reviewRequestedPage.sections[0];
    const firstRow = firstSection?.rows[0];
    expect(firstSection).toBeDefined();
    expect(firstRow).toBeDefined();
    expect(
      parsePullRequestListPage({
        ...reviewRequestedPage,
        sections: [
          {
            ...firstSection,
            rows: [{ ...firstRow, attention: { revision: "not-a-digest", state: "new" } }],
          },
        ],
      }),
    ).toBeNull();
  });

  it("marks attention unsupported when an older Companion omits it", () => {
    const firstSection = reviewRequestedPage.sections[0];
    const firstRow = firstSection?.rows[0];
    expect(firstSection).toBeDefined();
    expect(firstRow).toBeDefined();
    const { attention: _rowAttention, ...legacyRow } = firstRow ?? {};
    const { attention: _overviewAttention, ...legacyOverview } = overview91;
    const page = parsePullRequestListPage({
      ...reviewRequestedPage,
      sections: [{ ...firstSection, rows: [legacyRow] }],
    });

    expect(page?.sections[0]?.rows[0]?.attention).toEqual({ state: "unsupported" });
    expect(parsePullRequestOverview(legacyOverview, () => undefined)?.attention).toEqual({
      state: "unsupported",
    });
  });

  it("parses truncated pages and every patch state", () => {
    const page = parseFilesPage(filesPage);
    expect(page?.truncated).toEqual({ shown: 300, total: 1284 });
    expect(page?.files.map((file) => file.patch.state)).toEqual([
      "present",
      "tooLarge",
      "notProvided",
    ]);
    expect(page?.files.map((file) => file.viewed.source)).toEqual(["forge", "forge", "companion"]);
  });

  it("makes partial publication explicit per draft", () => {
    const outcome = parseSubmitOutcome({
      drafts: [
        { agent: "notRequested", draftId: "d1", error: null, pr: "published" },
        { agent: "sent", draftId: "d2", error: null, pr: "published" },
        {
          agent: "notRequested",
          draftId: "d4",
          error: "Line no longer in the diff",
          pr: "outdated",
        },
      ],
      reviewUrl: "https://github.com/MrFlashAccount/CodeWide/pull/91#pullrequestreview-1",
      runId: "run-1",
    });
    expect(outcome?.drafts.map((draft) => draft.pr)).toEqual([
      "published",
      "published",
      "outdated",
    ]);
  });

  it("reads the forge page an action run asks to finish on, absent from an older Companion", () => {
    const catalog = { actions: [], headRevision: "head-1" };
    const handOff = parseActionRun(
      {
        catalog,
        message: "Start CI in Arcanum",
        openUrl: "https://a.yandex-team.ru/review/1",
        runId: "r1",
      },
      () => undefined,
    );
    expect(handOff?.openUrl).toBe("https://a.yandex-team.ru/review/1");
    expect(
      parseActionRun({ catalog, message: null, runId: "r2" }, () => undefined)?.openUrl,
    ).toBeNull();
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
          action("disabled-reason", {
            availability: { reason: "Repository does not allow auto-merge", state: "disabled" },
          }),
          action("future-kind", { kind: "deploy" }),
          action("odd-placement", { placement: "floating" }),
          action("odd-anchor", { anchor: { kind: "sidebar" }, placement: "primary" }),
        ],
        headRevision: "3fa9e12",
      },
      report,
    );
    expect(report.mock.calls.map(([id]) => id)).toEqual([
      "unknown-confirm",
      "disabled-silent",
      "strange-input",
    ]);
    expect(catalog?.actions.map((item) => item.actionId)).toEqual([
      "disabled-reason",
      "future-kind",
      "odd-placement",
      "odd-anchor",
    ]);
    expect(catalog?.actions.find((item) => item.actionId === "future-kind")?.kind).toBe(
      "extension",
    );
    expect(catalog?.actions.find((item) => item.actionId === "odd-placement")?.placement).toBe(
      "overflow",
    );
    expect(catalog?.actions.find((item) => item.actionId === "odd-anchor")).toMatchObject({
      anchor: null,
      placement: "overflow",
    });
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
    expect(
      classifyForgeError(new RpcResponseError(-32_088, "Draft changed", { kind: "notFound" })).kind,
    ).toBe("conflict");
  });

  it("keeps a contract violation apart from an unreachable companion", () => {
    expect(classifyForgeError(new ForgeContractViolation("pull request list")).kind).toBe(
      "contractViolation",
    );
    expect(classifyForgeError(new Error("socket closed")).kind).toBe("unreachable");
  });
});

describe("review chat workspace contract", () => {
  const candidates = [
    { path: "/work/widget-pr", reason: "pullRequestBranch" },
    { path: "/work/widget", reason: "repository" },
  ];

  it("reads a ready chat and a needed choice with ranked candidates", () => {
    expect(parseReviewChatEnsure({ created: true, kind: "ready", threadId: "thread-1" })).toEqual({
      created: true,
      kind: "ready",
      threadId: "thread-1",
    });
    expect(parseReviewChatEnsure({ candidates, kind: "needsWorkspace" })).toEqual({
      candidates,
      kind: "needsWorkspace",
    });
    expect(parseReviewChatEnsure({ candidates: [], kind: "needsWorkspace" })).toEqual({
      candidates: [],
      kind: "needsWorkspace",
    });
    expect(parseScenarioStart({ created: false, kind: "started", threadId: "thread-1" })).toEqual({
      created: false,
      kind: "started",
      threadId: "thread-1",
    });
    expect(parseScenarioStart({ candidates, kind: "needsWorkspace" })).toMatchObject({
      kind: "needsWorkspace",
    });
  });

  it("rejects an untagged result, an unknown reason and the other method's tag", () => {
    expect(parseReviewChatEnsure({ created: false, threadId: "thread-1" })).toBeNull();
    expect(
      parseReviewChatEnsure({
        candidates: [{ path: "/work/widget", reason: "guess" }],
        kind: "needsWorkspace",
      }),
    ).toBeNull();
    expect(
      parseReviewChatEnsure({ created: false, kind: "started", threadId: "thread-1" }),
    ).toBeNull();
    expect(parseScenarioStart({ created: false, kind: "ready", threadId: "thread-1" })).toBeNull();
  });
});
