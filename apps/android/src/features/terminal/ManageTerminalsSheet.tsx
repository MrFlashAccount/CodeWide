import { createElement } from "react";
import { View } from "react-native";

import { readInteractiveTerminalWorkspace } from "../../data/interactive-terminal-store";
import { useNativeTerminalInventory } from "../../data/nativeTerminalInventory";
import type { NativeTerminalSession } from "../../native/native-transport";
import { useEvent } from "../../react/useEvent";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { AppListRowMenuTrigger } from "../../ui/AppListRowMenuTrigger";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ManageTerminalsSheet.styles";

type ManageTerminalServer = {
  readonly id: string;
  readonly name: string;
};

type ManageTerminalThread = {
  readonly id: string;
  readonly serverId: string;
  readonly title: string;
};

const CLOSE_ACTIONS: readonly ActionMenuItem[] = [
  { destructive: true, icon: "close-circle-outline", id: "close", label: "Close" },
];

/** Lists native-owned running terminals without creating or re-owning them. */
export function ManageTerminalsSheet({
  onClose,
  onCloseTerminal,
  onFocusTerminal,
  servers,
  threads,
  visible,
}: {
  readonly onClose: () => void;
  readonly onCloseTerminal: (sessionId: string) => void;
  readonly onFocusTerminal: (session: NativeTerminalSession) => void;
  readonly servers: readonly ManageTerminalServer[];
  readonly threads: readonly ManageTerminalThread[];
  readonly visible: boolean;
}): React.JSX.Element {
  const inventory = useNativeTerminalInventory();
  const changeOpen = useEvent((open: boolean): void => {
    if (!open) {
      onClose();
    }
  });
  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close terminal manager",
        enableDynamicSizing: true,
        index: 0,
      }}
      isOpen={visible}
      onOpenChange={changeOpen}
    >
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title}>
          Running terminals
        </Text>
      </View>
      {inventory.sessions.length === 0 ? (
        <Text style={styles.notice}>
          {inventory.status === "loading"
            ? "Loading terminals…"
            : inventory.status === "error"
              ? inventory.message
              : "No running terminals"}
        </Text>
      ) : (
        <AppSheetScrollView contentContainerStyle={styles.list}>
          {inventory.sessions.map((session, index) => (
            <ManagedTerminalRow
              key={session.sessionId}
              onClose={onCloseTerminal}
              onFocus={onFocusTerminal}
              position={listRowPosition(index, inventory.sessions.length)}
              servers={servers}
              session={session}
              threads={threads}
            />
          ))}
        </AppSheetScrollView>
      )}
    </AppSheet>
  );
}

function ManagedTerminalRow({
  onClose,
  onFocus,
  position,
  servers,
  session,
  threads,
}: {
  readonly onClose: (sessionId: string) => void;
  readonly onFocus: (session: NativeTerminalSession) => void;
  readonly position: "only" | "first" | "middle" | "last";
  readonly servers: readonly ManageTerminalServer[];
  readonly session: NativeTerminalSession;
  readonly threads: readonly ManageTerminalThread[];
}): React.JSX.Element {
  const focus = useEvent((): void => {
    onFocus(session);
  });
  const selectAction = useEvent((id: string): void => {
    if (id === "close") {
      onClose(session.sessionId);
    }
  });
  const identity = terminalIdentity(session, servers, threads);
  const menuLabel = `Terminal actions, ${identity.title}`;
  return (
    <AppListRow
      accessibilityLabel={`${identity.title}, ${identity.description}`}
      description={identity.description}
      fixedHeight={listRowHeight.double}
      leadingIcon={{ name: "terminal-outline" }}
      onPress={focus}
      position={position}
      testID={`managed-terminal:${session.sessionId}`}
      title={identity.title}
      trailing={createElement(ManagedTerminalMenu, { menuLabel, onSelect: selectAction })}
    />
  );
}

function ManagedTerminalMenu({
  menuLabel,
  onSelect,
}: {
  readonly menuLabel: string;
  readonly onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <ActionMenu accessibilityLabel={menuLabel} actions={CLOSE_ACTIONS} onSelect={onSelect}>
      <AppListRowMenuTrigger accessibilityLabel={menuLabel} />
    </ActionMenu>
  );
}

function terminalIdentity(
  session: NativeTerminalSession,
  servers: readonly ManageTerminalServer[],
  threads: readonly ManageTerminalThread[],
): { readonly description: string; readonly title: string } {
  const thread = threads.find(
    (candidate) => candidate.serverId === session.connectionId && candidate.id === session.threadId,
  );
  const server = servers.find((candidate) => candidate.id === session.connectionId);
  const title =
    readInteractiveTerminalWorkspace(session.connectionId, session.threadId).tabs.find(
      (candidate) => candidate.id === session.sessionId,
    )?.title ?? "Terminal";
  if (thread !== undefined) {
    return {
      description: server === undefined ? thread.title : `${thread.title} · ${server.name}`,
      title,
    };
  }
  if (server !== undefined) {
    return { description: session.cwd ?? server.name, title };
  }
  return { description: session.cwd ?? session.threadId, title };
}
