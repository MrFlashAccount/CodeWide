/**
 * The accounts of the usage menu: every server's account pool profiles and
 * the sign-ins of providers without a pool, as one list grouped by provider.
 * The same account signed in on several servers is one row (matched by
 * provider and email); its servers are listed with it when it is not on every
 * listed server.
 */
import {
  accountProfileRateLimitsStale,
  accountRateLimitResetWindows,
  relativeResetTime,
  selectWeeklyRateLimit,
} from "../../data/account-rate-limits";
import {
  accountPlanLabel,
  accountUsageProfiles,
  type AccountUsageSource,
} from "../../data/account-usage-presentation";
import type { AccountPoolProfile } from "../../data/account-pool";
import {
  accountPoolPresence,
  type AgentProviderStatusEntry,
  type AgentProvidersState,
} from "../../data/agentProviders";
import type { AccountUsageServer } from "../../data/thread-list-account-usage";
import { accountResetWindowRemainingPercent } from "./accountResetPresentation";
import {
  providerAccountEntries,
  providerAccountTitle,
  providerLimitRemaining,
  providerLimitRings,
} from "./providerAccountPresentation";

const FIVE_HOUR_WINDOW_MINUTES = 300;

/** How a row's note reads: plain, needing a refresh, or a problem with the account. */
type UsageAccountTone = "attention" | "muted" | "problem";

/** What the row shows on its right: the shares left, or why they are not known. */
type UsageAccountValue =
  | {
      /** Session (five-hour) share left; `null` when the account has no such window. */
      readonly fiveHour: number | null;
      readonly kind: "remaining";
      readonly weekly: number;
    }
  | { readonly kind: "note"; readonly text: string; readonly tone: UsageAccountTone };

export type UsageAccountRow = {
  /** Whether the account is the one in use (pool) or signed in (provider). */
  readonly active: boolean;
  readonly key: string;
  /** The account's email, or its provider's account when it has none. */
  readonly label: string;
  readonly plan: string;
  /** The provider whose account it is; `null` for an older Companion that does not say. */
  readonly provider: { readonly id: string; readonly name: string } | null;
  /** Time left until the weekly limit resets, e.g. `3d 8h`. */
  readonly resetsIn: string | null;
  /** Servers the account is on, shown only when it is not on every listed server. */
  readonly servers: readonly AccountUsageServer[];
  readonly value: UsageAccountValue;
};

/** All account rows of the listed servers, duplicates merged, grouped by provider. */
export function usageAccountRows(
  sources: readonly AccountUsageSource[],
  servers: readonly AccountUsageServer[],
  providerStates: Readonly<Record<string, AgentProvidersState | undefined>> | undefined,
): UsageAccountRow[] {
  const rows = mergeSameAccounts([
    ...poolAccountRows(sources, servers, providerStates),
    ...servers.flatMap((server) =>
      providerAccountEntries(providerStates?.[server.id]).map((entry) =>
        providerAccountRow(entry, server),
      ),
    ),
  ]);
  const everywhere = servers.length;
  return groupByProvider(
    rows.map((row) =>
      everywhere <= 1 || row.servers.length === everywhere ? { ...row, servers: [] } : row,
    ),
  );
}

function poolAccountRows(
  sources: readonly AccountUsageSource[],
  servers: readonly AccountUsageServer[],
  providerStates: Readonly<Record<string, AgentProvidersState | undefined>> | undefined,
): UsageAccountRow[] {
  return sources.flatMap((source) => {
    const server = servers.find((candidate) => candidate.id === source.id);
    const presence = accountPoolPresence(providerStates?.[source.id]);
    const owner = presence.kind === "present" ? presence.owner : null;
    return accountUsageProfiles([source]).map((account): UsageAccountRow => ({
      active: account.profile.enabled && account.profile.active,
      key: `${source.id}/${account.profile.id}`,
      label: account.label,
      plan: account.detail,
      provider: owner === null ? null : { id: owner.id, name: owner.name },
      servers: server === undefined ? [] : [server],
      ...poolProfileUsage(account.profile),
    }));
  });
}

/** Shares left and reset of one pool profile, or why they are unknown. */
function poolProfileUsage(
  profile: AccountPoolProfile,
): Pick<UsageAccountRow, "resetsIn" | "value"> {
  const weekly = selectWeeklyRateLimit(profile.rateLimits);
  const stale = profile.enabled && accountProfileRateLimitsStale(profile);
  const note = poolProfileNote(profile, stale);
  if (note !== null || weekly === null) {
    return { resetsIn: null, value: note ?? { kind: "note", text: "Unavailable", tone: "muted" } };
  }
  return {
    resetsIn: resetsIn(profile.exhaustedUntil ?? weekly.window.resetsAt),
    value: {
      fiveHour: poolFiveHourRemaining(profile),
      kind: "remaining",
      weekly: Math.round(weekly.remainingPercent),
    },
  };
}

/** Why a pool profile shows no shares: disabled, out of date, or failing. */
function poolProfileNote(profile: AccountPoolProfile, stale: boolean): UsageAccountValue | null {
  if (!profile.enabled) {
    return { kind: "note", text: "Disabled", tone: "muted" };
  }
  if (profile.rateLimitsError !== null) {
    return { kind: "note", text: "Can't connect", tone: "problem" };
  }
  if (profile.exhaustedIndefinitely) {
    return { kind: "note", text: "Limit reached", tone: "problem" };
  }
  return stale ? { kind: "note", text: "Refresh", tone: "attention" } : null;
}

function poolFiveHourRemaining(profile: AccountPoolProfile): number | null {
  const window = accountRateLimitResetWindows(profile).find(
    (candidate) => candidate.durationMins === FIVE_HOUR_WINDOW_MINUTES,
  );
  if (window === undefined) {
    return null;
  }
  const remaining = accountResetWindowRemainingPercent(window);
  return remaining === null ? null : Math.round(remaining);
}

/** A provider's single sign-in on one server, with its limits when reported. */
function providerAccountRow(
  entry: AgentProviderStatusEntry,
  server: AccountUsageServer,
): UsageAccountRow {
  return {
    active: entry.status === "live" && entry.auth === "authenticated",
    key: `${server.id}/${entry.id}`,
    label: providerAccountTitle(entry),
    plan: accountPlanLabel(entry.planLabel),
    provider: { id: entry.id, name: entry.name },
    servers: [server],
    ...providerAccountUsage(entry),
  };
}

function providerAccountUsage(
  entry: AgentProviderStatusEntry,
): Pick<UsageAccountRow, "resetsIn" | "value"> {
  if (entry.status !== "live") {
    return { resetsIn: null, value: { kind: "note", text: "Can't connect", tone: "problem" } };
  }
  if (entry.auth === "unauthenticated") {
    return { resetsIn: null, value: { kind: "note", text: "Signed out", tone: "problem" } };
  }
  const rings = providerLimitRings(entry.limits);
  const weekly = rings.weekly === null ? null : providerLimitRemaining(rings.weekly);
  if (rings.weekly === null || weekly === null) {
    return {
      resetsIn: null,
      value: {
        kind: "note",
        text: entry.limits.kind === "pending" ? "Usage unknown" : "Signed in",
        tone: "muted",
      },
    };
  }
  return {
    resetsIn: resetsIn(rings.weekly.resetsAt),
    value: {
      fiveHour: rings.session === null ? null : providerLimitRemaining(rings.session),
      kind: "remaining",
      weekly,
    },
  };
}

/** The time left until a reset, without the leading "in". */
function resetsIn(resetAt: number | null): string | null {
  const relative = relativeResetTime(resetAt);
  return relative === null ? null : relative.replace(/^in /u, "");
}

/**
 * One row per account: rows of the same provider and email are the same
 * account signed in on several servers. The row with the most current figure
 * represents them; their servers are listed together.
 */
function mergeSameAccounts(rows: readonly UsageAccountRow[]): UsageAccountRow[] {
  const merged = new Map<string, UsageAccountRow>();
  for (const row of rows) {
    const identity = accountIdentity(row);
    const existing = merged.get(identity);
    if (existing === undefined) {
      merged.set(identity, row);
      continue;
    }
    const representative = rowRank(row) > rowRank(existing) ? row : existing;
    merged.set(identity, {
      ...representative,
      servers: [
        ...existing.servers,
        ...row.servers.filter(
          (server) => !existing.servers.some((known) => known.id === server.id),
        ),
      ],
    });
  }
  return [...merged.values()];
}

/** Rows merge only by email; any other label stays one row per server. */
function accountIdentity(row: UsageAccountRow): string {
  return row.label.includes("@")
    ? JSON.stringify([row.provider?.id ?? null, row.label.trim().toLowerCase()])
    : row.key;
}

/** Weight of a current figure over an active account when choosing a representative. */
const CURRENT_FIGURE_RANK = 2;

/** Prefers a row with a current figure, then an active account. */
function rowRank(row: UsageAccountRow): number {
  return (row.value.kind === "remaining" ? CURRENT_FIGURE_RANK : 0) + (row.active ? 1 : 0);
}

/** Rows of one provider together, providers in order of their first row. */
function groupByProvider(rows: readonly UsageAccountRow[]): UsageAccountRow[] {
  const groups = new Map<string | null, UsageAccountRow[]>();
  for (const row of rows) {
    const id = row.provider?.id ?? null;
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, [row]);
    } else {
      group.push(row);
    }
  }
  return [...groups.values()].flat();
}
