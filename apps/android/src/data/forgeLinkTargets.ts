import type { StoredConnection } from "./connection-profile-types";
import {
  forgeAccountKey,
  pullRequestKey,
  type ForgeAccountsSnapshot,
  type PullRequestKey,
  type ForgeAccountKey,
} from "./forgeContract";
import { list, nonEmptyText, record } from "./forgeWire";

/** A route verified for one account on one Companion. */
export interface ForgeLinkTarget {
  readonly account: ForgeAccountKey;
  readonly canonical: PullRequestKey;
  readonly connectionId: string;
  readonly login: string;
  readonly number: string;
  readonly provider: string;
  readonly pullRequest: PullRequestKey;
  readonly repository: string;
  readonly server: string;
  readonly serverIconId: StoredConnection["iconId"];
}
/** Connection metadata needed to resolve a link, excluding secrets and endpoints. */
export type LinkServer = Pick<
  StoredConnection,
  "id" | "displayName" | "iconId" | "enabled" | "state"
>;

/** Strip private query and fragment data before a URL crosses any Companion boundary. */
export function forgePageUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      return null;
    }
    return new URL(url.origin + url.pathname);
  } catch {
    return null;
  }
}

/** Read-only provider discovery and link admission. */
export interface ForgeLinkAuthority {
  readonly directory: (connectionId: string) => Promise<ForgeAccountsSnapshot>;
  readonly resolve: (connectionId: string, pluginId: string, url: string) => Promise<unknown>;
}

/** A linked account exists on this host, but its provider cannot resolve shared PR links. */
export class ForgeLinkUnsupportedError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super("The installed forge plugin does not support opening pull request links.");
    this.provider = provider;
  }
}

/** Resolve on declared page hosts only. A disabled catalog still permits opening an explicit link. */
async function serverTargets(
  server: LinkServer,
  url: URL,
  authority: ForgeLinkAuthority,
): Promise<readonly ForgeLinkTarget[]> {
  const snapshot = await authority.directory(server.id);
  const reads = snapshot.providers.flatMap((provider) => {
    const accounts = snapshot.accounts.filter(
      (account) => account.pluginId === provider.pluginId && account.state === "connected",
    );
    const ownsHost =
      provider.linkHosts.some((host) => host.toLowerCase() === url.host) ||
      accounts.some((account) => account.host.toLowerCase() === url.host);
    if (!provider.enabled || !ownsHost || accounts.length === 0) {
      return [];
    }
    return [
      async (): Promise<ForgeLinkTarget[]> => {
        if (!provider.capabilities.includes("forge.pullRequestLink@1")) {
          throw new ForgeLinkUnsupportedError(provider.forgeName);
        }
        const raw = await authority.resolve(server.id, provider.pluginId, url.href);
        const rows = list(raw, "targets", (value, path) => {
          const row = record(value, path);
          return {
            account: forgeAccountKey(row.account, path),
            canonical: pullRequestKey(row.canonical, path),
            number: nonEmptyText(row.number, path),
            pullRequest: pullRequestKey(row.pullRequest, path),
            repository: nonEmptyText(row.repository, path),
          };
        });
        return rows.flatMap((row) => {
          const identity = accounts.find((account) => account.account === row.account);
          return identity === undefined
            ? []
            : [
                {
                  ...row,
                  connectionId: server.id,
                  login: identity.login,
                  provider: provider.forgeName,
                  server: server.displayName,
                  serverIconId: server.iconId,
                },
              ];
        });
      },
    ];
  });
  return collectAccessible(reads);
}

async function collectAccessible<T>(
  reads: readonly (() => Promise<readonly T[]>)[],
  previousFailure: Error | null = null,
): Promise<T[]> {
  const results = await Promise.allSettled(reads.map(async (read) => read()));
  const targets = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (targets.length > 0) {
    return targets;
  }
  let failure = previousFailure;
  for (const result of results) {
    if (result.status === "rejected") {
      if (!(result.reason instanceof ForgeLinkUnsupportedError)) {
        throw new Error("Could not check pull request access");
      }
      failure ??= result.reason;
    }
  }
  if (failure !== null) {
    throw failure;
  }
  return targets;
}

/** A chat's own server wins. Sharing has no originating server and searches every available directory. */
export async function findForgeLinkTargets(
  {
    origin,
    servers,
    url,
  }: { readonly origin: string | null; readonly servers: readonly LinkServer[]; readonly url: URL },
  authority: ForgeLinkAuthority,
): Promise<readonly ForgeLinkTarget[]> {
  const available = servers.filter(
    (server) => server.enabled && server.state !== "offline" && server.state !== "authRequired",
  );
  const local = available.find((server) => server.id === origin);
  const fallback = available
    .filter((server) => server !== local)
    .map((server) => async () => serverTargets(server, url, authority));
  if (local !== undefined) {
    try {
      const matches = await serverTargets(local, url, authority);
      if (matches.length > 0) {
        return matches;
      }
    } catch (error) {
      // Keep the origin's failure if no other server can open the link.
      return collectAccessible(
        fallback,
        error instanceof Error ? error : new Error("Could not check pull request access"),
      );
    }
  }
  return collectAccessible(fallback);
}

/** Identical forge accounts on multiple servers produce one account choice, retaining every chat placement. */
export function groupForgeLinkTargets(
  targets: readonly ForgeLinkTarget[],
): readonly (readonly [ForgeLinkTarget, ...ForgeLinkTarget[]])[] {
  const groups = new Map<string, [ForgeLinkTarget, ...ForgeLinkTarget[]]>();
  for (const target of targets) {
    const key = JSON.stringify([target.account, target.canonical]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [target]);
    } else {
      group.push(target);
    }
  }
  return Array.from(groups.values());
}
