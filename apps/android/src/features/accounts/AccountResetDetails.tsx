import { Pressable, View } from "react-native";
import type { RateLimitResetCredit } from "@codewide/codex-protocol/v0.147.0/v2";

import type { AccountPoolProfile } from "../../data/account-pool";
import { accountRateLimitResetWindows, relativeResetTime } from "../../data/account-rate-limits";
import { formatDeviceDateTime } from "../../data/device-time";
import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "../../ui/AppDialog";
import { percentageDimension } from "../../ui/percentageDimension";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";
import {
  accountBankedResets,
  accountLimitProgressColor,
  accountResetCreditExpiry,
  accountResetCreditTitle,
  accountResetWindowLabel,
  accountResetWindowRemainingPercent,
} from "./accountResetPresentation";

const MILLISECONDS_PER_SECOND = 1000;
const NO_BANKED_RESETS = 0n;
const SINGLE_BANKED_RESET = 1n;
const PERCENT_MAX = 100;
const OTHER_WINDOW_ORDER = 2;
const FIVE_HOUR_WINDOW_HOURS = 5;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const MINUTES_PER_HOUR = 60;
const FIVE_HOUR_WINDOW_MINUTES = FIVE_HOUR_WINDOW_HOURS * MINUTES_PER_HOUR;
const WEEKLY_WINDOW_MINUTES = DAYS_PER_WEEK * HOURS_PER_DAY * MINUTES_PER_HOUR;

export function AccountResetDetails({
  busy,
  label,
  now,
  onUseReset,
  profile,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly now: number;
  readonly onUseReset: (creditId: string | null) => void;
  readonly profile: AccountPoolProfile;
}): React.JSX.Element {
  const windows = accountRateLimitResetWindows(profile);
  windows.sort(compareResetWindowPresentationOrder);
  const banked = accountBankedResets(profile);
  const dialog = useAppDialog();
  const requestUseReset = useEvent((creditId: string | null, resetTitle: string) => {
    dialog.alert(
      `Use ${resetTitle}?`,
      `Apply this reset to ${label}? It will be consumed immediately and cannot be undone.`,
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            onUseReset(creditId);
          },
          text: "Use",
        },
      ],
    );
  });
  return (
    <View style={styles.accountResetDetails} testID={`account-reset-details-${profile.id}`}>
      <Text style={styles.accountResetSectionTitle}>Limit windows</Text>
      {windows.length === 0 ? (
        <Text style={styles.accountResetUnavailable}>
          {profile.exhaustedIndefinitely
            ? "Upstream did not report a reset time."
            : "Reset windows are not available yet."}
        </Text>
      ) : (
        windows.map((window) => (
          <AccountResetWindowRow
            key={`${window.slot}-${String(window.resetsAt)}`}
            now={now}
            window={window}
          />
        ))
      )}
      <Text style={styles.accountResetSectionTitle}>
        Banked resets · {String(banked.availableCount)}
      </Text>
      {banked.availableCount === NO_BANKED_RESETS ? (
        <Text style={styles.accountResetUnavailable}>No banked resets available.</Text>
      ) : (
        banked.credits.map((credit) => (
          <BankedResetRow
            busy={busy}
            credit={credit}
            key={credit.id}
            label={label}
            now={now}
            onRequestUseReset={requestUseReset}
          />
        ))
      )}
      {banked.undisclosedCount > NO_BANKED_RESETS && (
        <BankedResetFallbackRow
          busy={busy}
          count={banked.undisclosedCount}
          label={label}
          onRequestUseReset={requestUseReset}
        />
      )}
      {profile.rateLimitsError !== null && (
        <Text style={styles.accountResetError}>Last refresh failed · showing saved limits</Text>
      )}
    </View>
  );
}

function BankedResetRow({
  busy,
  credit,
  label,
  now,
  onRequestUseReset,
}: {
  readonly busy: boolean;
  readonly credit: RateLimitResetCredit;
  readonly label: string;
  readonly now: number;
  readonly onRequestUseReset: (creditId: string | null, resetTitle: string) => void;
}): React.JSX.Element {
  const expired = credit.expiresAt !== null && credit.expiresAt * MILLISECONDS_PER_SECOND <= now;
  const usable = credit.status === "available" && !expired;
  const resetTitle = accountResetCreditTitle(credit);
  const useReset = useEvent(() => {
    if (!busy && usable) {
      onRequestUseReset(credit.id, resetTitle);
    }
  });
  return (
    <Pressable
      accessibilityLabel={usable ? `Use ${resetTitle} for ${label}` : undefined}
      accessibilityRole={usable ? "button" : undefined}
      accessibilityState={usable ? { disabled: busy } : undefined}
      disabled={busy || !usable}
      onPress={useReset}
      style={({ pressed }) => [
        styles.accountBankedReset,
        pressed && styles.accountBankedResetPressed,
      ]}
      testID={`account-banked-reset-${credit.id}`}
    >
      <View style={styles.flex}>
        <Text style={styles.accountResetWindowLabel}>{resetTitle}</Text>
        <Text style={styles.accountResetWindowTime}>
          {bankedResetExpiryLabel(credit.expiresAt, now)}
        </Text>
      </View>
      {credit.status === "redeeming" && <Text style={styles.accountResetStatus}>Using…</Text>}
    </Pressable>
  );
}

function bankedResetExpiryLabel(expiresAt: number | null, now: number): string {
  if (expiresAt === null) {
    return accountResetCreditExpiry(null, now);
  }
  return `${formatDeviceDateTime(expiresAt)} · ${accountResetCreditExpiry(expiresAt, now)}`;
}

function BankedResetFallbackRow({
  busy,
  count,
  label,
  onRequestUseReset,
}: {
  readonly busy: boolean;
  readonly count: bigint;
  readonly label: string;
  readonly onRequestUseReset: (creditId: string | null, resetTitle: string) => void;
}): React.JSX.Element {
  const resetTitle = "the next banked reset";
  const useReset = useEvent(() => {
    if (!busy) {
      onRequestUseReset(null, resetTitle);
    }
  });
  return (
    <Pressable
      accessibilityLabel={`Use ${resetTitle} for ${label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={useReset}
      style={({ pressed }) => [
        styles.accountBankedReset,
        pressed && styles.accountBankedResetPressed,
      ]}
      testID="account-banked-reset-undisclosed"
    >
      <View style={styles.flex}>
        <Text style={styles.accountResetWindowLabel}>
          {String(count)} more {count === SINGLE_BANKED_RESET ? "reset" : "resets"}
        </Text>
      </View>
    </Pressable>
  );
}

function AccountResetWindowRow({
  now,
  window,
}: {
  readonly now: number;
  readonly window: ReturnType<typeof accountRateLimitResetWindows>[number];
}): React.JSX.Element {
  const remaining = accountResetWindowRemainingPercent(window);
  const label = `${accountResetWindowLabel(window)} window`;
  const relative = relativeResetTime(window.resetsAt, now);
  const resetLabel =
    relative === "reset due"
      ? "Reset due"
      : relative === null
        ? "Reset time unavailable"
        : `Resets ${relative}`;
  return (
    <View style={styles.accountResetWindow}>
      <View style={styles.accountResetWindowCopy}>
        <Text style={styles.accountResetWindowLabel}>{label}</Text>
        <Text style={styles.accountResetWindowTime}>{resetLabel}</Text>
      </View>
      <View
        style={styles.accountResetWindowMeter}
        testID={`account-reset-window-meter-${window.slot}`}
      >
        <AccountResetProgress label={label} remaining={remaining} slot={window.slot} />
        <Text
          style={styles.accountResetWindowRemaining}
          testID={`account-reset-window-remaining-${window.slot}`}
        >
          {remaining === null ? "Usage pending" : `${String(remaining)}% left`}
        </Text>
      </View>
    </View>
  );
}

function AccountResetProgress({
  label,
  remaining,
  slot,
}: {
  readonly label: string;
  readonly remaining: number | null;
  readonly slot: string;
}): React.JSX.Element {
  return (
    <View
      accessibilityLabel={`${label} remaining`}
      accessibilityRole="progressbar"
      accessibilityValue={
        remaining === null
          ? { max: PERCENT_MAX, min: 0, text: "Usage pending" }
          : { max: PERCENT_MAX, min: 0, now: remaining }
      }
      style={styles.accountResetProgressTrack}
      testID={`account-reset-window-progress-${slot}`}
    >
      {remaining === null ? null : (
        <View
          style={[
            styles.accountResetProgressFill,
            {
              backgroundColor: accountLimitProgressColor(remaining),
              width: percentageDimension(remaining),
            },
          ]}
        />
      )}
    </View>
  );
}

function compareResetWindowPresentationOrder(
  left: ReturnType<typeof accountRateLimitResetWindows>[number],
  right: ReturnType<typeof accountRateLimitResetWindows>[number],
): number {
  const orderDifference =
    resetWindowOrder(left.durationMins) - resetWindowOrder(right.durationMins);
  return orderDifference === 0 ? left.resetsAt - right.resetsAt : orderDifference;
}

function resetWindowOrder(durationMins: number | null): number {
  if (durationMins === WEEKLY_WINDOW_MINUTES) {
    return 0;
  }
  return durationMins === FIVE_HOUR_WINDOW_MINUTES ? 1 : OTHER_WINDOW_ORDER;
}
