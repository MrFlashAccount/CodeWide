/**
 * Accounts of providers without an account pool (Claude), next to the pool
 * editor. Each provider gets a section with one read-only account row: the
 * server's sign-in and the subscription limits the provider reports. There are
 * no account actions; signing in happens in the provider's CLI on the server.
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
import { AppText as Text } from "../../ui/Typography";
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

/** One section per enabled provider whose sign-in is not an account pool. */
export function ProviderAccounts({
  agentProviders,
  connectionId,
  serverName,
}: {
  readonly agentProviders: Pick<AgentProvidersResource, "state$">;
  readonly connectionId: string;
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
        <ProviderAccountSection entry={entry} key={entry.id} serverName={serverName} />
      ))}
    </>
  );
}

function ProviderAccountSection({
  entry,
  serverName,
}: {
  readonly entry: AgentProviderStatusEntry;
  readonly serverName: string;
}): React.JSX.Element {
  return (
    <View style={styles.accountPoolEditor} testID={`provider-accounts-${entry.id}`}>
      <View style={styles.accountPoolHeader}>
        <ProviderIcon provider={entry.id} size={iconSize.inline} />
        <Text accessibilityRole="header" style={[styles.fieldLabel, styles.flex]}>
          {entry.name}
        </Text>
      </View>
      {providerAccountShowsLimits(entry) ? (
        <ProviderAccountLimitsRow entry={entry} serverName={serverName} />
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
  entry,
  serverName,
}: {
  readonly entry: AgentProviderStatusEntry;
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
      {expanded && <ProviderLimitDetails entry={entry} now={now} />}
    </View>
  );
}

function ProviderLimitDetails({
  entry,
  now,
}: {
  readonly entry: AgentProviderStatusEntry;
  readonly now: number;
}): React.JSX.Element {
  return (
    <View
      style={[styles.accountResetDetailsSurface, styles.accountResetDetailsSurfaceLast]}
      testID={`provider-account-details-${entry.id}`}
    >
      <ProviderLimitWindows limits={entry.limits} now={now} providerName={entry.name} />
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
