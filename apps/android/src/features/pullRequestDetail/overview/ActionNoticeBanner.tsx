import { View } from "react-native";

import { AppText as Text } from "../../../ui/Typography";
import type { ActionNotice } from "../pullRequestScreenModel";
import { overviewStyles as styles } from "./overview.styles";

/**
 * What happened to the last write that did not go as asked: the head moved
 * (nothing written, actions refreshed), the outcome is unknown, or the forge
 * answered with a message. Refusals render next to their own control.
 */
export function ActionNoticeBanner({
  host,
  notice,
}: {
  readonly host: string;
  readonly notice: ActionNotice | null;
}): React.JSX.Element | null {
  if (notice === null || notice.kind === "refused") {
    return null;
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
