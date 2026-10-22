import { Pressable, View } from "react-native";

import type { LinkedThread } from "../../../data/forgePullRequestContract";
import type { ThreadId } from "../../../data/reviewContract";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text } from "../../../ui/Typography";
import { CardHeader, CardNote } from "./CardHeader";
import { overviewStyles as styles } from "./overview.styles";

/** Title and activity of a thread, resolved by route composition from the thread catalog. */
export type LinkedThreadDescription = { readonly status: string; readonly title: string };

const SOURCE_LABELS: Readonly<Record<LinkedThread["source"], string>> = {
  agent: "linked by agent",
  branch: "linked by branch",
  manual: "linked manually",
};

const UNLINK_ACTIONS = [{ destructive: true, id: "unlink", label: "Unlink" }] as const;

/**
 * Threads working on this PR, with why each is linked. A row opens its thread;
 * long-press offers Unlink, which only changes companion link state and keeps
 * the branch from re-linking it.
 */
export function LinkedThreadsCard({
  describeThread,
  links,
  onOpenThread,
  onUnlink,
}: {
  readonly describeThread: (threadId: ThreadId) => LinkedThreadDescription | null;
  readonly links: readonly LinkedThread[];
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onUnlink: (threadId: ThreadId) => void;
}): React.JSX.Element {
  return (
    <View style={styles.card} testID="pull-request-linked-threads">
      <CardHeader meta={String(links.length)} title="Linked threads" />
      {links.length === 0 ? <CardNote text="No thread works on this pull request yet." /> : null}
      {links.map((link) => (
        <LinkedThreadRow
          description={describeThread(link.threadId)}
          key={link.threadId}
          link={link}
          onOpenThread={onOpenThread}
          onUnlink={onUnlink}
        />
      ))}
    </View>
  );
}

function LinkedThreadRow({
  description,
  link,
  onOpenThread,
  onUnlink,
}: {
  readonly description: LinkedThreadDescription | null;
  readonly link: LinkedThread;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onUnlink: (threadId: ThreadId) => void;
}): React.JSX.Element {
  const title = description?.title ?? "Thread";
  const detail =
    description === null
      ? SOURCE_LABELS[link.source]
      : `${description.status} · ${SOURCE_LABELS[link.source]}`;
  return (
    <ActionMenu
      accessibilityLabel={`${title} actions`}
      actions={UNLINK_ACTIONS}
      onSelect={() => {
        onUnlink(link.threadId);
      }}
      trigger="long-press"
    >
      <Pressable
        accessibilityHint="Long press to unlink"
        accessibilityLabel={`${title}, ${detail}`}
        accessibilityRole="button"
        onPress={() => {
          onOpenThread(link.threadId);
        }}
        style={styles.cardLine}
      >
        <TwoLineText detail={detail} title={title} />
      </Pressable>
    </ActionMenu>
  );
}

/** Title over a muted detail line, both single-line with end ellipsis. */
function TwoLineText({
  detail,
  title,
}: {
  readonly detail: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.lineBody}>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.body}>
        {title}
      </Text>
      <Text numberOfLines={1} style={styles.meta}>
        {detail}
      </Text>
    </View>
  );
}
