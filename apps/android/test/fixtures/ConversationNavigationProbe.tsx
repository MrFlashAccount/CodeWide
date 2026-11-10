import { Pressable, Text, View } from "react-native";

import { ContentDocumentPress } from "../../src/features/conversation/content/ContentDocumentPress";
import { LargeContentViewerHost } from "../../src/features/conversation/content/FullContentViewer";
import { useConversationRouteNavigation } from "../../src/features/conversation/conversationRouteNavigation";

/** The document a shortened user bubble opens on press. */
export const bubbleDocument = {
  connectionId: "server",
  kind: "document",
  parts: [{ kind: "inline", text: "Shortened message" }],
  threadId: "review-thread",
  title: "Message",
};

/** One request per conversation destination; each names its intent. */
export const navigationRequests = {
  openAgents: {
    initialThreadId: null,
    parentLabel: null,
    parentThreadId: "review-thread",
    summaries: [],
  },
  openAttachments: { openCodeDocument: () => undefined },
  openChanges: { kind: "current" },
  openCodeDocument: { kind: "codeDocument" },
  openContent: { kind: "command", threadId: "review-thread" },
  openDocument: { kind: "text", name: "notes.md", path: "/workspace/notes.md" },
  openTaskOutput: { taskId: "task" },
  openTerminal: { connectionId: "server", cwd: null, threadId: "review-thread" },
  openTool: { kind: "queue" },
  openTurnChanges: { kind: "turn", target: { turnId: "turn" } },
} as const;

type ProbedIntent = keyof typeof navigationRequests;

/**
 * Stands in for the mounted conversation: a shortened user bubble wired through the real
 * `ContentDocumentPress` and `LargeContentViewerHost`, plus one button per navigation intent.
 */
export function ConversationNavigationProbe(): React.JSX.Element {
  const navigation = useConversationRouteNavigation();
  return (
    <View testID="probe-conversation">
      <LargeContentViewerHost>
        <ContentDocumentPress accessibilityLabel="Open full message" document={bubbleDocument}>
          <Text>Shortened message</Text>
        </ContentDocumentPress>
      </LargeContentViewerHost>
      {(Object.keys(navigationRequests) as ProbedIntent[]).map((intent) => (
        <Pressable
          accessibilityRole="button"
          key={intent}
          onPress={() => {
            const open = navigation[intent] as (request: unknown) => void;
            open(navigationRequests[intent]);
          }}
        >
          <Text>{intent}</Text>
        </Pressable>
      ))}
    </View>
  );
}
