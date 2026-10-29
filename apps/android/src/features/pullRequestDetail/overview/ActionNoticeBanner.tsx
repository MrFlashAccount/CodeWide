import { View } from "react-native";

import { AppText as Text } from "../../../ui/Typography";
import type { ActionNotice } from "../pullRequestScreenModel";
import { overviewStyles as styles } from "./overview.styles";

/**
 * What happened to the last write that did not go as asked: the head moved
 * (nothing written, actions refreshed), the outcome is unknown, the forge
 * refused it with a reason, it answered with a message, or an agent scenario's
 * run failed.
 */
export function ActionNoticeBanner({
  host,
  notice,
}: {
  readonly host: string;
  readonly notice: ActionNotice | null;
}): React.JSX.Element | null {
  if (notice === null) {
    return null;
  }
  if (notice.kind === "refused") {
    return (
      <View accessibilityRole="alert" style={[styles.banner, styles.bannerError]}>
        <Text style={styles.body}>{`✕ ${host} refused: ${notice.reason}`}</Text>
      </View>
    );
  }
  if (notice.kind === "agentFailed") {
    return (
      <View
        accessibilityRole="alert"
        style={[styles.banner, styles.bannerError]}
        testID="pull-request-notice-agentFailed"
      >
        <Text style={styles.body}>{`✕ ${notice.label} failed: ${notice.reason}`}</Text>
      </View>
    );
  }
  if (notice.kind === "message") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.banner}>
        <Text style={styles.body}>{notice.text}</Text>
      </View>
    );
  }
  const stale = notice.kind === "stale";
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, styles.bannerError]}
      testID={`pull-request-notice-${notice.kind}`}
    >
      <Text style={styles.title}>
        {stale ? "↻ PR changed since this screen loaded" : "! The result on the forge is unknown"}
      </Text>
      <Text style={styles.meta}>
        {stale
          ? `Nothing was written to ${host}. Actions were refreshed for the new head.`
          : `Refresh before trying again; ${host} may or may not have applied it.`}
      </Text>
    </View>
  );
}
