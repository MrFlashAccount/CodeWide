import { accountPlanLabel } from "../../data/account-usage-presentation";
import {
  agentProvidersValue,
  MULTI_PROVIDER_COUNT,
  type AgentProviderRuntimeStatus,
  type AgentProviderStatusEntry,
  type AgentProvidersState,
} from "../../data/agentProviders";

/** One provider status line of the server detail screen. Never a pool account. */
export type AgentProviderStatusLine = {
  readonly id: string;
  /** e.g. `Claude · signed in · Max`. */
  readonly label: string;
  /** Whether the provider needs the user's attention on the server. */
  readonly warning: boolean;
};

const NOT_LIVE_TEXT: Readonly<Record<Exclude<AgentProviderRuntimeStatus, "live">, string>> = {
  disabled: "disabled on this server",
  reconnecting: "reconnecting",
  unavailable: "unavailable on this server",
};

/**
 * Provider lines to show for one server: only when the server reports more than
 * one provider (several enabled, or a disabled one). An older Companion without
 * the provider list, and a server with one provider, show nothing, as before.
 */
export function agentProviderStatusLines(
  state: AgentProvidersState | undefined,
): readonly AgentProviderStatusLine[] {
  const value = state === undefined ? null : agentProvidersValue(state);
  if (value === null || value.providers.length < MULTI_PROVIDER_COUNT) {
    return [];
  }
  return value.providers.map((entry) => ({
    id: entry.id,
    label: agentProviderStatusLabel(entry),
    warning: entry.status !== "live" || entry.auth === "unauthenticated",
  }));
}

/** Status, sign-in and plan of one provider. */
function agentProviderStatusLabel(entry: AgentProviderStatusEntry): string {
  return entry.status === "live"
    ? `${entry.name} · ${signInText(entry)}`
    : `${entry.name} · ${NOT_LIVE_TEXT[entry.status]}`;
}

/** The sign-in hint names the provider id as the server-side command, the CLI it runs (`claude`). */
function signInText(entry: AgentProviderStatusEntry): string {
  if (entry.auth === "authenticated") {
    return entry.planLabel === null
      ? "signed in"
      : `signed in · ${accountPlanLabel(entry.planLabel)}`;
  }
  if (entry.auth === "unauthenticated") {
    return `not signed in — run \`${entry.id}\` on the server to sign in`;
  }
  return "connected";
}
