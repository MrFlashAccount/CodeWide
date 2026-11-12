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
import {
  CatalogRowBody,
  CatalogRowLeading,
  type CatalogRowMarker,
  CatalogRowSubtitle,
  CatalogRowSubtitleLine,
  CatalogRowTitle,
  CatalogRowTitleLine,
  CatalogRowTrailing,
} from "../../ui/CatalogRow";
import { ServerIcon } from "../connections/ServerIcon";
import { styles } from "./ThreadRow.styles";
import { ThreadPullRequestBadge } from "./ThreadPullRequestBadge";
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
      <CatalogRowBody>
        <CatalogRowTitleLine>
          {server !== undefined && (
            <CatalogRowLeading accessibilityLabel={`Server ${server.name}`}>
              <ServerIcon color={colors.textMuted} iconId={server.iconId} metric="body" />
            </CatalogRowLeading>
          )}
          <CatalogRowTitle running={thread.state === "running"} value={thread.title} />
          {thread.state === "failed" && (
            <View
              accessibilityLabel={`Thread ${thread.state}`}
              accessible
              style={styles.threadStatusIcon}
            >
              <Ionicons color={colors.red} name="alert-circle" size={iconSize.inline} />
            </View>
          )}
          <CatalogRowTrailing
            age={
              thread.time ?? formatThreadRecency(thread.timestamp ?? 0, readDeviceTimePreferences())
            }
            ageTestID="thread-time"
            markers={threadMarkers(thread)}
          >
            <ThreadProviderSlot
              label={thread.agentBadge ?? null}
              provider={thread.agentProvider ?? null}
            />
          </CatalogRowTrailing>
        </CatalogRowTitleLine>
        <CatalogRowSubtitleLine>
          {thread.state === "running" ? (
            <RunningThreadPreview thread={thread} />
          ) : (
            <ThreadPreview preview={thread.preview} />
          )}
          <ThreadPullRequestBadge connectionId={thread.serverId} threadId={thread.id} />
        </CatalogRowSubtitleLine>
      </CatalogRowBody>
    </>
  );
}

/** A pending request outranks the unread mark; the unread mark returns once it clears. */
function threadMarkers(thread: ThreadRowProps["thread"]): readonly CatalogRowMarker[] {
  if (thread.needsAttention === true) {
    return [{ kind: "attention", label: "Требуется твоё внимание" }];
  }
  return thread.unread > 0 ? [{ kind: "unread", label: "Unread thread" }] : [];
}

function ThreadPreview({ preview }: { readonly preview: string }): ReactElement {
  return <CatalogRowSubtitle testID="thread-preview" text={plainThreadPreview(preview)} />;
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
  return <CatalogRowSubtitle testID="thread-live-activity" text={label} />;
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
