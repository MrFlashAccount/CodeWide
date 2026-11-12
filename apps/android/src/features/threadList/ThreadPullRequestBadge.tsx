import { useSelector } from "@legendapp/state/react";
import { StyleSheet, View } from "react-native";

import { pullRequestLinkResources } from "../../data/forgeRuntime";
import { pullRequestBadgeKey } from "../../data/pullRequestLinkResources";
import { iconSize, spacing } from "../../theme";
import { ForgeIcon } from "../../ui/ForgeIcon";
import { CatalogRowMetaText } from "../../ui/CatalogRow";

/**
 * PR badge of a thread row: the provider icon and number of its first linked
 * PR, plus `+N` for more. A visible row demands its badges once; threads
 * without links, and companions without forge methods, render nothing.
 */
export function ThreadPullRequestBadge({
  connectionId,
  threadId,
}: {
  readonly connectionId: string;
  readonly threadId: string;
}): React.JSX.Element | null {
  pullRequestLinkResources.demand(connectionId, threadId);
  const badges = useSelector(() =>
    pullRequestLinkResources.badges$[pullRequestBadgeKey(connectionId, threadId)]?.get(),
  );
  const [first, ...rest] = badges ?? [];
  if (first === undefined) {
    return null;
  }
  return (
    <View
      accessibilityLabel={`Pull request ${first.number}${rest.length === 0 ? "" : ` and ${String(rest.length)} more`}`}
      accessible
      style={styles.badge}
      testID="thread-pull-request-badge"
    >
      <ForgeIcon icon={first.icon} size={iconSize.indicator} />
      <CatalogRowMetaText>
        {rest.length === 0 ? `#${first.number}` : `#${first.number} +${String(rest.length)}`}
      </CatalogRowMetaText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    columnGap: spacing.optical,
    flexDirection: "row",
    flexShrink: 0,
  },
});
