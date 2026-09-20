/** V1 AccountPoolFeature owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { accountProfileLabel, type AccountPoolSnapshot } from "../../data/account-pool";
import {
  accountRateLimitResetWindows,
  selectAccountRateLimitPlanType,
  selectWeeklyRateLimit,
} from "../../data/account-rate-limits";
import { accountPlanLabel } from "../../data/account-usage-presentation";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { styles } from "./AccountPoolFeature.styles";
import { AccountLimitRings } from "./AccountLimitRings";
import { AccountResetDetails } from "./AccountResetDetails";
import {
  accountBankedResetSummary,
  accountResetWindowRemainingPercent,
} from "./accountResetPresentation";

import type { AccountPoolProps } from "./accountCapabilities";

export function AccountProfileRow({
  busy,
  connectionId,
  count,
  index,
  onActivate,
  onConsumeResetCredit,
  onRemove,
  onUpdate,
  profile,
  run,
}: Pick<
  AccountPoolProps,
  "connectionId" | "onActivate" | "onConsumeResetCredit" | "onUpdate" | "onRemove"
> & {
  busy: boolean;
  count: number;
  index: number;
  profile: AccountPoolSnapshot["profiles"][number];
  run: (operation: () => Promise<unknown>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const label = accountProfileLabel(profile, index);
  const weekly = selectWeeklyRateLimit(profile.rateLimits);
  const fiveHourWindow = accountRateLimitResetWindows(profile).find(
    (window) => window.durationMins === FIVE_HOUR_WINDOW_MINUTES,
  );
  const weeklyRemainingPercent = weekly === null ? null : Math.round(weekly.remainingPercent);
  const fiveHourRemainingPercent =
    fiveHourWindow === undefined ? null : accountResetWindowRemainingPercent(fiveHourWindow);
  const exhausted =
    profile.exhaustedUntil !== null ||
    profile.exhaustedIndefinitely ||
    weekly?.remainingPercent === 0;
  const accountStatus = exhausted ? "exhausted" : profile.active ? "active" : "inactive";
  const position = listRowPosition(index, count + ADD_ACCOUNT_ROW_COUNT);
  const rowPosition =
    expanded && position === "only"
      ? "first"
      : expanded && position === "last"
        ? "middle"
        : position;
  const priorityLabel = index === 0 ? "Primary" : `Backup ${String(index)}`;
  const bankedResetSummary = accountBankedResetSummary(profile);
  const planLabel = accountPlanLabel(
    selectAccountRateLimitPlanType(profile.rateLimits) ?? profile.planType,
  );
  const description = `${planLabel} · ${priorityLabel}${profile.enabled ? "" : " · disabled"}${bankedResetSummary === null ? "" : ` · ${bankedResetSummary}`}`;
  const limitLabel =
    weeklyRemainingPercent === null
      ? "Weekly usage pending"
      : `Weekly ${String(weeklyRemainingPercent)}% left`;
  const actions: ActionMenuItem[] = [
    {
      disabled: profile.active || !profile.enabled,
      icon: "person-circle-outline",
      id: "activate",
      label: profile.active ? "Active account" : "Switch to account",
      selected: profile.active,
    },
    ...(index === 0
      ? []
      : [{ icon: "star-outline" as const, id: "make-primary", label: "Make primary" }]),
    ...(count > 2 && index > 0
      ? [{ icon: "arrow-up" as const, id: "move-up", label: "Move earlier" }]
      : []),
    ...(count > 2 && index < count - 1
      ? [{ icon: "arrow-down" as const, id: "move-down", label: "Move later" }]
      : []),
    {
      icon: profile.enabled ? "pause-circle-outline" : "play-circle-outline",
      id: "toggle-enabled",
      label: profile.enabled ? "Disable fallback" : "Enable fallback",
      selected: profile.enabled,
    },
    ...(!profile.active
      ? [
          {
            destructive: true,
            icon: "trash-outline" as const,
            id: "remove",
            label: "Remove account",
          },
        ]
      : []),
  ];
  const handleAction = useEvent((id: string) => {
    if (id === "activate") {
      run(async () => onActivate(connectionId, profile.id));
    } else if (id === "make-primary") {
      run(async () => onUpdate(connectionId, profile.id, { priority: 0 }));
    } else if (id === "move-up") {
      run(async () => onUpdate(connectionId, profile.id, { priority: index - 1 }));
    } else if (id === "move-down") {
      run(async () => onUpdate(connectionId, profile.id, { priority: index + 1 }));
    } else if (id === "toggle-enabled") {
      run(async () => onUpdate(connectionId, profile.id, { enabled: !profile.enabled }));
    } else if (id === "remove") {
      run(async () => onRemove(connectionId, profile.id));
    }
  });
  const toggleExpanded = useEvent(() => {
    setNow(Date.now());
    setExpanded((current) => !current);
  });
  const useBankedReset = useEvent((creditId: string | null) => {
    run(async () => {
      const result = await onConsumeResetCredit(connectionId, profile.id, creditId);
      const message = resetCreditOutcomeError(result.outcome);
      if (message !== null) {
        throw new Error(message);
      }
    });
  });
  return (
    <View>
      <AppListRow
        accessibilityHint={expanded ? "Collapse reset details" : "Expand reset details"}
        accessibilityLabel={`${label}. Account ${accountStatus}. ${description}. ${limitLabel}`}
        description={description}
        expanded={expanded}
        fixedHeight={listRowHeight.double}
        leading={
          <AccountLimitRings
            fiveHour={
              fiveHourWindow === undefined
                ? { kind: "absent" }
                : { kind: "present", remainingPercent: fiveHourRemainingPercent }
            }
            testID={`account-limit-rings-${profile.id}`}
            weeklyRemainingPercent={weeklyRemainingPercent}
          />
        }
        onPress={toggleExpanded}
        position={rowPosition}
        testID={`account-profile-${profile.id}`}
        title={label}
        titleIndicator={{
          color: accountStatusColor(!profile.enabled ? "inactive" : accountStatus),
          size: ACCOUNT_STATUS_DOT_SIZE,
          testID: `account-status-${profile.id}`,
        }}
        trailing={
          <ActionMenu
            accessibilityLabel={`Actions for ${label}`}
            actions={actions}
            onSelect={handleAction}
            style={styles.accountPoolMenuAnchor}
          >
            <Pressable
              accessibilityLabel={`Actions for ${label}`}
              disabled={busy}
              style={[styles.connectionMiniButton, busy && styles.disabled]}
            >
              <Ionicons
                color={colors.textMuted}
                name="ellipsis-horizontal"
                size={iconSize.action}
              />
            </Pressable>
          </ActionMenu>
        }
      />
      {expanded && (
        <View
          style={[
            styles.accountResetDetailsSurface,
            (position === "last" || position === "only") && styles.accountResetDetailsSurfaceLast,
            position !== "last" && position !== "only" && styles.accountResetDetailsSeparator,
          ]}
          testID={`account-reset-details-surface-${profile.id}`}
        >
          <AccountResetDetails
            busy={busy}
            label={label}
            now={now}
            onUseReset={useBankedReset}
            profile={profile}
          />
        </View>
      )}
    </View>
  );
}

function accountStatusColor(status: "active" | "exhausted" | "inactive"): string {
  if (status === "active") {
    return colors.green;
  }
  return status === "exhausted" ? colors.red : colors.textDim;
}

const ACCOUNT_STATUS_DOT_SIZE = 12;
const FIVE_HOUR_WINDOW_HOURS = 5;
const ADD_ACCOUNT_ROW_COUNT = 1;
const MINUTES_PER_HOUR = 60;
const FIVE_HOUR_WINDOW_MINUTES = FIVE_HOUR_WINDOW_HOURS * MINUTES_PER_HOUR;

function resetCreditOutcomeError(
  outcome: "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed",
): string | null {
  if (outcome === "reset") {
    return null;
  }
  if (outcome === "nothingToReset") {
    return "This account has no used limits to reset.";
  }
  if (outcome === "alreadyRedeemed") {
    return "This banked reset was already used.";
  }
  return "This banked reset is no longer available.";
}
