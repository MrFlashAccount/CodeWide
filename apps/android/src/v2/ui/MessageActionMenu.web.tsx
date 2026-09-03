import { setStringAsync } from "expo-clipboard";
import { createContext, useContext, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { useAppDialog } from "./AppDialog";
import type {
  MessageActionMenuProviderProps,
  MessageActionMenuRequest,
  OpenMessageActionMenu,
} from "./MessageActionMenu.types";

const MessageActionMenuContext = createContext<OpenMessageActionMenu | null>(null);

interface ConfirmedAction {
  action(): Promise<void> | void;
  fallback: string;
  title: string;
}

export function useMessageActionMenu(): OpenMessageActionMenu {
  const open = useContext(MessageActionMenuContext);
  if (open === null) throw new Error("Message actions require MessageActionMenuProvider");
  return open;
}

export function MessageActionMenuProvider(
  props: MessageActionMenuProviderProps,
): React.JSX.Element {
  const { children } = props;
  const alert = useAppDialog();
  const [request, setRequest] = useState<MessageActionMenuRequest | null>(null);
  const confirmedActionRef = useRef<ConfirmedAction | null>(null);
  const open = useEvent<OpenMessageActionMenu>((next) => setRequest(next));
  const close = useEvent(() => setRequest(null));
  const copy = useEvent(() => {
    if (request?.copyText !== undefined && request.copyText !== "")
      void setStringAsync(request.copyText).catch(() => undefined);
    close();
  });
  const activate = useEvent(
    (title: string, fallback: string, action: (() => Promise<void> | void) | undefined) => {
      close();
      if (action === undefined) return;
      void Promise.resolve(action()).catch((cause: unknown) => {
        alert(title, cause instanceof Error ? cause.message : fallback);
      });
    },
  );
  const runConfirmedAction = useEvent(() => {
    const confirmed = confirmedActionRef.current;
    if (confirmed === null) return;
    confirmedActionRef.current = null;
    activate(confirmed.title, confirmed.fallback, confirmed.action);
  });
  const confirmDestructive = useEvent((confirmed: ConfirmedAction, title: string) => {
    close();
    confirmedActionRef.current = confirmed;
    alert(title, "All later turns will be removed.", [
      { text: "Cancel", style: "cancel" },
      { onPress: runConfirmedAction, style: "destructive", text: "Continue" },
    ]);
  });
  const edit = useEvent(() => {
    if (request?.onEdit === undefined) return;
    confirmDestructive(
      { action: request.onEdit, fallback: "Could not edit message", title: "Edit failed" },
      "Edit from this message?",
    );
  });
  const fork = useEvent(() => activate("Fork failed", "Could not fork thread", request?.onFork));
  const interrupt = useEvent(() =>
    activate("Stop failed", "Could not stop turn", request?.onInterrupt),
  );
  const review = useEvent(() =>
    activate("Review failed", "Could not review response", request?.onReview),
  );
  const rollback = useEvent(() => {
    if (request?.onRollback === undefined) return;
    confirmDestructive(
      {
        action: request.onRollback,
        fallback: "Could not roll back turn",
        title: "Rollback failed",
      },
      "Roll back to this message?",
    );
  });
  return (
    <MessageActionMenuContext.Provider value={open}>
      {children}
      <Modal animationType="fade" onRequestClose={close} transparent visible={request !== null}>
        <Pressable
          accessibilityLabel="Dismiss message actions"
          onPress={close}
          style={styles.backdrop}
        >
          <View style={styles.menu}>
            <Pressable accessibilityLabel="Copy message" onPress={copy} style={styles.row}>
              <Text style={styles.label}>Copy</Text>
            </Pressable>
            {request?.onEdit === undefined ? null : (
              <Pressable accessibilityLabel="Edit message" onPress={edit} style={styles.row}>
                <Text style={styles.label}>Edit message</Text>
              </Pressable>
            )}
            {request?.onFork === undefined ? null : (
              <Pressable accessibilityLabel="Fork from message" onPress={fork} style={styles.row}>
                <Text style={styles.label}>Fork</Text>
              </Pressable>
            )}
            {request?.onRollback === undefined ? null : (
              <Pressable
                accessibilityLabel="Roll back to message"
                onPress={rollback}
                style={styles.row}
              >
                <Text style={styles.label}>Roll back to here</Text>
              </Pressable>
            )}
            {request?.onReview === undefined ? null : (
              <Pressable accessibilityLabel="Review response" onPress={review} style={styles.row}>
                <Text style={styles.label}>Review response</Text>
              </Pressable>
            )}
            {request?.onInterrupt === undefined ? null : (
              <Pressable accessibilityLabel="Stop response" onPress={interrupt} style={styles.row}>
                <Text style={styles.destructiveLabel}>Stop response</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </MessageActionMenuContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: colors.scrim,
    flex: 1,
    justifyContent: "center",
  },
  destructiveLabel: { color: colors.red, ...typeScale.body },
  label: { color: colors.text, ...typeScale.body },
  menu: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.menu,
    minWidth: 220,
    paddingVertical: spacing.xs,
  },
  row: { minHeight: 50, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
