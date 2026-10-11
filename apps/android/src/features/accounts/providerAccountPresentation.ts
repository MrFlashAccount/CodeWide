/**
 * Accounts of providers without an account pool (Claude): the server's single
 * sign-in shown as a read-only account row, with the provider-level
 * subscription limits it reports. No switching, login or removal: the
 * sign-in lives in the provider's CLI on the server and CodeWide never
 * handles its credentials.
 */
import { accountPlanLabel } from "../../data/account-usage-presentation";
import {
  agentProvidersValue,
  type AgentProviderStatusEntry,
  type AgentProvidersState,
  type ProviderLimits,
  type ProviderLimitWindow,
} from "../../data/agentProviders";
import { providerBrand } from "../../ui/providerBrand";

const PERCENT_MAX = 100;
const PERCENT_MIN = 0;

/** Enabled providers whose sign-in is not an account pool, in the server's order. */
export function providerAccountEntries(
  state: AgentProvidersState | undefined,
): readonly AgentProviderStatusEntry[] {
  const value = state === undefined ? null : agentProvidersValue(state);
  if (value === null) {
    return [];
  }
  return value.providers.filter(
    (entry) =>
      entry.status !== "disabled" &&
      entry.capabilities !== null &&
      !entry.capabilities.includes("accounts.pool"),
  );
}

/** The provider entry a thread's usage menu reads, when the provider reports limits. */
export function providerLimitsEntry(
  state: AgentProvidersState | undefined,
  provider: string,
): AgentProviderStatusEntry | null {
  const value = state === undefined ? null : agentProvidersValue(state);
  const entry = value?.providers.find((candidate) => candidate.id === provider) ?? null;
  return entry === null || entry.limits.kind === "notReported" ? null : entry;
}

/** Whether the account row shows limit rings and details: signed in, live and reporting limits. */
export function providerAccountShowsLimits(entry: AgentProviderStatusEntry): boolean {
  return (
    entry.status === "live" && entry.auth === "authenticated" && entry.limits.kind !== "notReported"
  );
}

/** Row title: the signed-in account when known, otherwise the provider's account. */
export function providerAccountTitle(entry: AgentProviderStatusEntry): string {
  return entry.auth === "authenticated" && entry.accountLabel !== null
    ? entry.accountLabel
    : `${entry.name} account`;
}

/** Sign-in line: where the sign-in lives, or what to run on the server. */
export function providerAccountDescription(
  entry: AgentProviderStatusEntry,
  serverName: string,
): string {
  if (entry.status === "reconnecting") {
    return `${entry.name} is reconnecting on ${serverName}`;
  }
  if (entry.status === "unavailable") {
    return `${entry.name} is unavailable on ${serverName}`;
  }
  const product = providerBrand(entry.id).productName ?? entry.name;
  if (entry.auth === "authenticated") {
    const signedIn = `Signed in via ${product} on ${serverName}`;
    return entry.planLabel === null
      ? signedIn
      : `${accountPlanLabel(entry.planLabel)} · ${signedIn}`;
  }
  if (entry.auth === "unauthenticated") {
    return `Not signed in — run \`${entry.id}\` on the server`;
  }
  return `Sign-in state unknown on ${serverName}`;
}

/**
 * Remaining share of a window, 0–100; `null` while its usage is unknown. A
 * rejected window without a reported share is exhausted.
 */
export function providerLimitRemaining(window: ProviderLimitWindow): number | null {
  if (window.usedPercent === null) {
    return window.status === "rejected" ? PERCENT_MIN : null;
  }
  return Math.round(Math.max(PERCENT_MIN, Math.min(PERCENT_MAX, PERCENT_MAX - window.usedPercent)));
}

/** The account-wide windows the compact rings show: weekly outside, session inside. */
export function providerLimitRings(limits: ProviderLimits): {
  readonly session: ProviderLimitWindow | null;
  readonly weekly: ProviderLimitWindow | null;
} {
  if (limits.kind !== "known") {
    return { session: null, weekly: null };
  }
  return {
    session: limits.windows.find((window) => window.kind === "session") ?? null,
    weekly: limits.windows.find((window) => window.kind === "weekly") ?? null,
  };
}

/** Collapsed-row summary of the limits. */
export function providerLimitsSummary(limits: ProviderLimits): string {
  if (limits.kind !== "known" || limits.windows.length === 0) {
    return "Usage unknown";
  }
  const rings = providerLimitRings(limits);
  const window = rings.weekly ?? rings.session ?? limits.windows[0];
  const remaining = window === undefined ? null : providerLimitRemaining(window);
  return window === undefined || remaining === null
    ? "Usage unknown"
    : `${window.label} ${String(remaining)}% left`;
}
