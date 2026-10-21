import { useState } from "react";
import { Pressable, View } from "react-native";

import type { ProviderRateLimitResets, ProviderResetGrant } from "../../data/agentProviders";
import { formatDeviceDateTime } from "../../data/device-time";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";

const MILLISECONDS_PER_SECOND = 1000;
const RESET_TITLES: Readonly<Record<ProviderResetGrant["kind"], string>> = {
  full: "Full reset",
  other: "Banked reset",
  session: "Session reset",
  weekly: "Weekly reset",
};

/** Banked reset inventory and the provider-qualified consume action. */
export function ProviderResetDetails({
  now,
  onUseReset,
  providerName,
  resets,
  serverName,
}: {
  readonly now: number;
  readonly onUseReset: (grantId: string) => Promise<void>;
  readonly providerName: string;
  readonly resets: ProviderRateLimitResets;
  readonly serverName: string;
}): React.JSX.Element {
  const [pendingGrantId, setPendingGrantId] = useState<string | null>(null);
  const dialog = useAppDialog();
  const requestUseReset = useEvent((grant: ProviderResetGrant) => {
    if (pendingGrantId !== null || !grant.usableNow) {
      return;
    }
    const title = resetTitle(grant);
    dialog.alert(
      `Use ${title}?`,
      `Apply this reset to ${providerName} on ${serverName}? It will be consumed immediately and cannot be undone.`,
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            setPendingGrantId(grant.id);
            onUseReset(grant.id).then(
              () => {
                setPendingGrantId(null);
              },
              (error: unknown) => {
                setPendingGrantId(null);
                const fallback = `Could not use ${title}`;
                dialog.alert(fallback, error instanceof Error ? error.message : fallback);
              },
            );
          },
          text: "Use",
        },
      ],
    );
  });
  return (
    <View testID="provider-reset-details">
      <Text style={styles.accountResetSectionTitle}>
        Banked resets · {String(resets.availableCount)}
      </Text>
      {!resets.eligible ? (
        <Text style={styles.accountResetUnavailable}>
          Banked resets are not available for this account.
        </Text>
      ) : resets.grants.length === 0 ? (
        <Text style={styles.accountResetUnavailable}>No banked resets available.</Text>
      ) : (
        resets.grants.map((grant) => (
          <ProviderResetGrantRow
            busy={pendingGrantId !== null}
            grant={grant}
            key={grant.id}
            now={now}
            onRequestUseReset={requestUseReset}
            pending={pendingGrantId === grant.id}
            providerName={providerName}
          />
        ))
      )}
    </View>
  );
}

function ProviderResetGrantRow({
  busy,
  grant,
  now,
  onRequestUseReset,
  pending,
  providerName,
}: {
  readonly busy: boolean;
  readonly grant: ProviderResetGrant;
  readonly now: number;
  readonly onRequestUseReset: (grant: ProviderResetGrant) => void;
  readonly pending: boolean;
  readonly providerName: string;
}): React.JSX.Element {
  const expired = grant.expiresAt !== null && grant.expiresAt * MILLISECONDS_PER_SECOND <= now;
  const usable = grant.usableNow && !expired;
  const useReset = useEvent(() => {
    if (!busy && usable) {
      onRequestUseReset(grant);
    }
  });
  return (
    <Pressable
      accessibilityLabel={usable ? `Use ${resetTitle(grant)} for ${providerName}` : undefined}
      accessibilityRole={usable ? "button" : undefined}
      accessibilityState={usable ? { disabled: busy } : undefined}
      disabled={busy || !usable}
      onPress={useReset}
      style={({ pressed }) => [
        styles.accountBankedReset,
        pressed && styles.accountBankedResetPressed,
      ]}
      testID={`provider-reset-grant-${grant.id}`}
    >
      <View style={styles.flex}>
        <Text shimmering={pending} style={styles.accountResetWindowLabel}>
          {resetTitle(grant)}
        </Text>
        <Text shimmering={pending} style={styles.accountResetWindowTime}>
          {resetDescription(grant, now)}
        </Text>
      </View>
      <Text shimmering={pending} style={styles.accountResetStatus}>
        {resetStatus(grant, now)}
      </Text>
    </Pressable>
  );
}

function resetTitle(grant: ProviderResetGrant): string {
  return grant.label === "" ? RESET_TITLES[grant.kind] : grant.label;
}

function resetDescription(grant: ProviderResetGrant, now: number): string {
  const count = `${String(grant.resetsLeft)} of ${String(grant.resetsTotal)} left`;
  if (grant.expiresAt === null) {
    return count;
  }
  const expiry = grant.expiresAt * MILLISECONDS_PER_SECOND;
  return expiry <= now
    ? `${count} · Expired`
    : `${count} · Expires ${formatDeviceDateTime(grant.expiresAt)}`;
}

function resetStatus(grant: ProviderResetGrant, now: number): string {
  if (grant.expiresAt !== null && grant.expiresAt * MILLISECONDS_PER_SECOND <= now) {
    return "Expired";
  }
  if (grant.paused) {
    return "Paused";
  }
  if (grant.usableNow) {
    return "Ready";
  }
  return grant.useRequiresLimit ? "At limit" : "Unavailable";
}
