import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import type { ReactElement } from "react";
import { View } from "react-native";
import { readDeviceTimePreferences } from "../../data/device-time";
import { plainThreadPreview } from "../../data/thread-cache";
import { threadSummaryKey } from "../../data/thread-summary-projection";
import { threadLiveActivity$ } from "../../data/threadLiveActivity";
import { colors, iconSize } from "../../theme";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { RunningThreadTitle, ThreadTitle } from "../../ui/ThreadTitle";
import { AppText as Text } from "../../ui/Typography";
import { ServerIcon } from "../connections/ServerIcon";
import { styles } from "./ThreadRow.styles";
import type { ThreadRowProps } from "./threadRowContract";
import { threadLiveActivityLabel } from "./threadLiveActivityLabel";
import { formatThreadRecency } from "./threadTime";

export function ThreadRowContent({
  selected,
  server,
  thread,
}: Pick<ThreadRowProps, "thread" | "server" | "selected">): ReactElement {
  return (
    <>
      {selected && <View style={styles.selectionBar} />}
      <View style={styles.threadText}>
        <View style={styles.threadTitleLine}>
          {server !== undefined && (
            <View accessibilityLabel={`Server ${server.name}`} accessible>
              <ServerIcon color={colors.textMuted} iconId={server.iconId} metric="body" />
            </View>
          )}
          <View style={styles.threadTitleSlot}>
            {thread.state === "running" ? (
              <RunningThreadTitle value={thread.title} />
            ) : (
              <ThreadTitle running={false} value={thread.title} />
            )}
          </View>
          {thread.state === "failed" && (
            <View
              accessibilityLabel={`Thread ${thread.state}`}
              accessible
              style={styles.threadStatusIcon}
            >
              <Ionicons color={colors.red} name="alert-circle" size={iconSize.inline} />
            </View>
          )}
          <View style={styles.threadMeta}>
            {thread.needsAttention === true ? (
              <View
                accessibilityLabel="Требуется твоё внимание"
                accessible
                style={styles.threadAttentionIcon}
              >
                <Ionicons color={colors.text} name="hand-left-outline" size={iconSize.indicator} />
              </View>
            ) : (
              thread.unread > 0 && (
                <View style={styles.unreadSlot}>
                  <View accessibilityLabel="Unread thread" accessible style={styles.unreadDot} />
                </View>
              )
            )}
            <ThreadProviderSlot
              label={thread.agentBadge ?? null}
              provider={thread.agentProvider ?? null}
            />
            <Text numberOfLines={1} style={styles.threadTime} testID="thread-time">
              {thread.time ??
                formatThreadRecency(thread.timestamp ?? 0, readDeviceTimePreferences())}
            </Text>
          </View>
        </View>
        <View style={styles.threadPreviewLine}>
          {thread.state === "running" ? (
            <RunningThreadPreview thread={thread} />
          ) : (
            <ThreadPreview preview={thread.preview} />
          )}
        </View>
      </View>
    </>
  );
}

function ThreadPreview({ preview }: { readonly preview: string }): ReactElement {
  return (
    <Text numberOfLines={1} style={styles.threadPreview} testID="thread-preview">
      {plainThreadPreview(preview)}
    </Text>
  );
}

/**
 * Shows the agent's current reasoning title or plan step in place of the
 * preview while the turn runs. The running title already shimmers; this line does not.
 */
function RunningThreadPreview({
  thread,
}: {
  readonly thread: ThreadRowProps["thread"];
}): ReactElement {
  const activity = useSelector(() =>
    threadLiveActivity$[threadSummaryKey(thread.serverId, thread.id)]?.get(),
  );
  const label = activity === undefined ? null : threadLiveActivityLabel(activity);
  if (label === null) {
    return <ThreadPreview preview={thread.preview} />;
  }
  return (
    <Text numberOfLines={1} style={styles.threadPreview} testID="thread-live-activity">
      {label}
    </Text>
  );
}

function ThreadProviderSlot({
  label,
  provider,
}: {
  readonly label: string | null;
  readonly provider: string | null;
}): ReactElement {
  return (
    <View style={styles.threadAgentBadge} testID="thread-provider-slot">
      {label !== null && (
        <View accessibilityLabel={`Agent ${label}`} accessible testID="thread-agent-badge">
          <ProviderIcon provider={provider ?? ""} size={iconSize.indicator} />
        </View>
      )}
    </View>
  );
}
