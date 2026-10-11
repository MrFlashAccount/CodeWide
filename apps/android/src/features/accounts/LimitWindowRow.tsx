import { View } from "react-native";

import { relativeResetTime } from "../../data/account-rate-limits";
import { percentageDimension } from "../../ui/percentageDimension";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./AccountPoolFeature.styles";
import { accountLimitProgressColor } from "./accountResetPresentation";

const PERCENT_MAX = 100;

/**
 * One usage window: its label, reset time, remaining-capacity bar and "% left".
 * Shared by pool accounts (Codex) and provider-level limits (Claude).
 */
export function LimitWindowRow({
  label,
  now,
  remaining,
  resetsAt,
  testKey,
}: {
  readonly label: string;
  readonly now: number;
  /** Remaining share, 0–100; `null` while usage is unknown. */
  readonly remaining: number | null;
  /** Unix seconds; `null` when the reset time is unknown. */
  readonly resetsAt: number | null;
  /** Suffix of the row's test ids, unique within its list. */
  readonly testKey: string;
}): React.JSX.Element {
  const relative = relativeResetTime(resetsAt, now);
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
      <View style={styles.accountResetWindowMeter} testID={`account-reset-window-meter-${testKey}`}>
        <LimitProgress label={label} remaining={remaining} testKey={testKey} />
        <Text
          style={styles.accountResetWindowRemaining}
          testID={`account-reset-window-remaining-${testKey}`}
        >
          {remaining === null ? "Usage pending" : `${String(remaining)}% left`}
        </Text>
      </View>
    </View>
  );
}

function LimitProgress({
  label,
  remaining,
  testKey,
}: {
  readonly label: string;
  readonly remaining: number | null;
  readonly testKey: string;
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
      testID={`account-reset-window-progress-${testKey}`}
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
