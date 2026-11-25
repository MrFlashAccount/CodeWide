import { expect, it, vi } from "vitest";
import { parseForgeAccounts } from "../src/data/forgeContract";
import {
  findForgeLinkTargets,
  ForgeLinkUnsupportedError,
  forgePageUrl,
  groupForgeLinkTargets,
  type ForgeLinkAuthority,
  type LinkServer,
} from "../src/data/forgeLinkTargets";
import { connectedAccount, githubProvider, onboardingAccounts } from "./fixtures/forgeWireFixtures";

const servers: readonly LinkServer[] = ["Buddy", "Studio"].map((id) => ({
  id,
  displayName: id,
  iconId: "desktop",
  enabled: true,
  state: "live",
}));
const url = new URL("https://code.example/reviews/7");
function fixture() {
  const snapshot = parseForgeAccounts({
    ...onboardingAccounts,
    providers: [
      { ...githubProvider, linkHosts: ["code.example"], capabilities: ["forge.pullRequestLink@1"] },
    ],
    accounts: [
      { ...connectedAccount, catalogEnabled: false },
      { ...connectedAccount, login: "second", account: "other-key" },
    ],
  });
  if (snapshot === null) throw new Error("Invalid fixture");
  const target = (account: string) => ({
    account,
    canonical: "canonical",
    repository: "octo/repo",
    number: "7",
    pullRequest: "selected-" + account,
  });
  const resolve = vi.fn<ForgeLinkAuthority["resolve"]>(async (server) =>
    server === "Buddy"
      ? [target(connectedAccount.account)]
      : [target(connectedAccount.account), target("other-key")],
  );
  return { directory: async () => snapshot, resolve };
}
it("prefers the chat's server even if another server has the same account", async () => {
  const authority = fixture();
  const found = await findForgeLinkTargets({ servers, url, origin: "Buddy" }, authority);
  expect(found.map((entry) => entry.connectionId)).toEqual(["Buddy"]);
  expect(authority.resolve.mock.calls).toEqual([["Buddy", githubProvider.pluginId, url.href]]);
});
it("shares through an account and retains its eligible chat servers", async () => {
  const found = await findForgeLinkTargets({ servers, url, origin: null }, fixture());
  expect(groupForgeLinkTargets(found).map((group) => group.map((target) => target.server))).toEqual(
    [["Buddy", "Studio"], ["Studio"]],
  );
});
it("falls back to a reachable server and never sends other domains to a plugin", async () => {
  const authority = fixture();
  authority.resolve.mockRejectedValueOnce(new Error("offline"));
  expect(
    (await findForgeLinkTargets({ servers, url, origin: "Buddy" }, authority)).map(
      (target) => target.server,
    ),
  ).toEqual(["Studio", "Studio"]);
  authority.resolve.mockClear();
  expect(
    await findForgeLinkTargets(
      { servers, url: new URL("https://elsewhere.example/message"), origin: null },
      authority,
    ),
  ).toEqual([]);
  expect(authority.resolve).not.toHaveBeenCalled();
});
it("retains only host and pathname when admitting HTTPS links", () => {
  expect(forgePageUrl("https://code.example//other.test/file?private=query#part")?.href).toBe(
    "https://code.example//other.test/file",
  );
  expect(forgePageUrl("https://secret@code.example/pr/1")).toBeNull();
  expect(forgePageUrl("file:///app/private")).toBeNull();
});

it("distinguishes a linked account on an older plugin from an unrelated URL", async () => {
  const old = fixture();
  const snapshot = await old.directory();
  const directory = async () => ({
    ...snapshot,
    providers: snapshot.providers.map((provider) => ({ ...provider, capabilities: [] })),
  });
  const authority = { directory, resolve: old.resolve };
  for (const origin of [null, "Buddy"]) {
    await expect(findForgeLinkTargets({ servers, url, origin }, authority)).rejects.toBeInstanceOf(
      ForgeLinkUnsupportedError,
    );
  }
  expect(
    await findForgeLinkTargets(
      { servers, url: new URL("https://other.example/review/1"), origin: null },
      authority,
    ),
  ).toEqual([]);
  expect(old.resolve).not.toHaveBeenCalled();
});
