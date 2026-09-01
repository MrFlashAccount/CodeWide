import { setStringAsync } from "expo-clipboard";
import { createContext, useContext, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import type {
  MessageActionMenuProviderProps,
  MessageActionMenuRequest,
  OpenMessageActionMenu,
} from "./MessageActionMenu.types";

const MessageActionMenuContext = createContext<OpenMessageActionMenu | null>(null);

export function useMessageActionMenu(): OpenMessageActionMenu {
  const open = useContext(MessageActionMenuContext);
  if (open === null) throw new Error("Message actions require MessageActionMenuProvider");
  return open;
}

export function MessageActionMenuProvider(
  props: MessageActionMenuProviderProps,
): React.JSX.Element {
  const { children } = props;
  const [request, setRequest] = useState<MessageActionMenuRequest | null>(null);
  const open = useEvent<OpenMessageActionMenu>((next) => setRequest(next));
  const close = useEvent(() => setRequest(null));
  const copy = useEvent(() => {
    if (request?.copyText !== undefined && request.copyText !== "")
      void setStringAsync(request.copyText).catch(() => undefined);
    close();
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
  label: { color: colors.text, ...typeScale.body },
  menu: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.menu,
    minWidth: 220,
    paddingVertical: spacing.xs,
  },
  row: { minHeight: 50, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
