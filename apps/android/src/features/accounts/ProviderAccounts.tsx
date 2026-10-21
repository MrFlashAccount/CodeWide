/**
 * Accounts of providers without an account pool (Claude), next to the pool
 * editor. Each provider gets a section with one account row: the server's
 * sign-in and the subscription limits the provider reports. A declared reset
 * capability makes reported grants actionable; signing in and account
 * management remain in the provider's CLI on the server.
 */
import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { View } from "react-native";

import type { AgentProviderStatusEntry } from "../../data/agentProviders";
import type { AgentProvidersResource } from "../../data/agentProvidersResource";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { SettingsGroupHeader } from "../../ui/SettingsGroupHeader";
import { styles } from "./AccountPoolFeature.styles";
import { AccountLimitRings } from "./AccountLimitRings";
import {
  providerAccountDescription,
  providerAccountEntries,
  providerAccountShowsLimits,
  providerAccountTitle,
  providerLimitRemaining,
  providerLimitRings,
  providerLimitsSummary,
} from "./providerAccountPresentation";
import { ProviderLimitWindows } from "./ProviderLimitWindows";
import { ProviderResetDetails } from "./ProviderResetDetails";

/** One section per enabled provider whose sign-in is not an account pool. */
export function ProviderAccounts({
  agentProviders,
  connectionId,
  onConsumeReset,
  serverName,
}: {
  readonly agentProviders: Pick<AgentProvidersResource, "state$">;
  readonly connectionId: string;
  readonly onConsumeReset: (
    connectionId: string,
    providerId: string,
    grantId: string,
  ) => Promise<void>;
  readonly serverName: string;
}): React.JSX.Element | null {
  const state = useSelector(() => agentProviders.state$[connectionId]?.get());
  const entries = providerAccountEntries(state);
  if (entries.length === 0) {
    return null;
  }
  return (
    <>
      {entries.map((entry) => (
        <ProviderAccountSection
          connectionId={connectionId}
          entry={entry}
          key={entry.id}
          onConsumeReset={onConsumeReset}
          serverName={serverName}
        />
      ))}
    </>
  );
}

function ProviderAccountSection({
  connectionId,
  entry,
  onConsumeReset,
  serverName,
}: {
  readonly connectionId: string;
  readonly entry: AgentProviderStatusEntry;
  readonly onConsumeReset: (
    connectionId: string,
    providerId: string,
    grantId: string,
  ) => Promise<void>;
  readonly serverName: string;
}): React.JSX.Element {
  return (
    <View style={styles.accountPoolEditor} testID={`provider-accounts-${entry.id}`}>
      <SettingsGroupHeader
        leading={
          <ProviderIcon color={colors.textMuted} provider={entry.id} size={iconSize.inline} />
        }
        title={entry.name}
      />
      {providerAccountShowsLimits(entry) ? (
        <ProviderAccountLimitsRow
          connectionId={connectionId}
          entry={entry}
          onConsumeReset={onConsumeReset}
          serverName={serverName}
        />
      ) : (
        <ProviderAccountRow entry={entry} serverName={serverName} />
      )}
    </View>
  );
}

/** A provider account without limits to show: signed out, not live, or not reporting them. */
function ProviderAccountRow({
  entry,
  serverName,
}: {
  readonly entry: AgentProviderStatusEntry;
  readonly serverName: string;
}): React.JSX.Element {
  return (
    <AppListRow
      description={providerAccountDescription(entry, serverName)}
      leading={<ProviderIcon provider={entry.id} size={iconSize.action} />}
      multiline
      testID={`provider-account-${entry.id}`}
      title={providerAccountTitle(entry)}
      titleIndicator={{
        color:
          entry.status === "live" && entry.auth === "authenticated" ? colors.green : colors.textDim,
        size: ACCOUNT_STATUS_DOT_SIZE,
        testID: `provider-account-status-${entry.id}`,
      }}
    />
  );
}

/** A signed-in provider account with its limit rings; expands to every limit window. */
function ProviderAccountLimitsRow({
  connectionId,
  entry,
  onConsumeReset,
  serverName,
}: {
  readonly connectionId: string;
  readonly entry: AgentProviderStatusEntry;
  readonly onConsumeReset: (
    connectionId: string,
    providerId: string,
    grantId: string,
  ) => Promise<void>;
  readonly serverName: string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const title = providerAccountTitle(entry);
  const description = providerAccountDescription(entry, serverName);
  const toggleExpanded = useEvent(() => {
    setNow(Date.now());
    setExpanded((current) => !current);
  });
  return (
    <View>
      <AppListRow
        accessibilityHint={expanded ? "Collapse limit details" : "Expand limit details"}
        accessibilityLabel={`${title}. ${description}. ${providerLimitsSummary(entry.limits)}`}
        description={description}
        expanded={expanded}
        leading={<ProviderLimitRingsMark entry={entry} />}
        multiline
        onPress={toggleExpanded}
        position={expanded ? "first" : "only"}
        testID={`provider-account-${entry.id}`}
        title={title}
        titleIndicator={{
          color: colors.green,
          size: ACCOUNT_STATUS_DOT_SIZE,
          testID: `provider-account-status-${entry.id}`,
        }}
      />
      {expanded && (
        <ProviderLimitDetails
          connectionId={connectionId}
          entry={entry}
          now={now}
          onConsumeReset={onConsumeReset}
          serverName={serverName}
        />
      )}
    </View>
  );
}

function ProviderLimitDetails({
  connectionId,
  entry,
  now,
  onConsumeReset,
  serverName,
}: {
  readonly connectionId: string;
  readonly entry: AgentProviderStatusEntry;
  readonly now: number;
  readonly onConsumeReset: (
    connectionId: string,
    providerId: string,
    grantId: string,
  ) => Promise<void>;
  readonly serverName: string;
}): React.JSX.Element {
  const resets = entry.limits.kind === "known" ? entry.limits.resets : null;
  const showsResets = entry.capabilities?.includes("accounts.rateLimitResets") === true;
  const useReset = useEvent(async (grantId: string): Promise<void> => {
    await onConsumeReset(connectionId, entry.id, grantId);
  });
  return (
    <View
      style={[styles.accountResetDetailsSurface, styles.accountResetDetailsSurfaceLast]}
      testID={`provider-account-details-${entry.id}`}
    >
      <ProviderLimitWindows limits={entry.limits} now={now} providerName={entry.name} />
      {showsResets && resets !== null && (
        <ProviderResetDetails
          now={now}
          onUseReset={useReset}
          providerName={entry.name}
          resets={resets}
          serverName={serverName}
        />
      )}
    </View>
  );
}

/** The pool rows' rings: weekly remaining outside, session remaining inside. */
function ProviderLimitRingsMark({
  entry,
}: {
  readonly entry: AgentProviderStatusEntry;
}): React.JSX.Element {
  const rings = providerLimitRings(entry.limits);
  return (
    <AccountLimitRings
      fiveHour={
        rings.session === null
          ? { kind: "absent" }
          : { kind: "present", remainingPercent: providerLimitRemaining(rings.session) }
      }
      testID={`provider-limit-rings-${entry.id}`}
      weeklyRemainingPercent={rings.weekly === null ? null : providerLimitRemaining(rings.weekly)}
    />
  );
}

const ACCOUNT_STATUS_DOT_SIZE = 12;
