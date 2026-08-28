import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import {
  createContext,
  forwardRef,
  useContext,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, spacing } from "../theme";
import { AppSheet } from "./AppSheet";
import { useAppDialog } from "./AppDialog";
import type {
  MessageActionMenuProviderProps,
  MessageActionMenuRequest,
  OpenMessageActionMenu,
} from "./MessageActionMenu.types";
import { AppText as Text } from "./Typography";

type MessageActionMenuHandle = {
  open: OpenMessageActionMenu;
};

const MessageActionMenuContext = createContext<OpenMessageActionMenu | null>(null);

export function useMessageActionMenu(): OpenMessageActionMenu {
  const open = useContext(MessageActionMenuContext);
  if (open === null) throw new Error("Message actions require MessageActionMenuProvider");
  return open;
}

export function MessageActionMenuProvider({ children }: MessageActionMenuProviderProps) {
  const hostRef = useRef<MessageActionMenuHandle>(null);
  const open = useEvent<OpenMessageActionMenu>((request, event) => {
    hostRef.current?.open(request, event);
  });

  return (
    <MessageActionMenuContext.Provider value={open}>
      {children}
      <MessageActionMenuHost ref={hostRef} />
    </MessageActionMenuContext.Provider>
  );
}

const MessageActionMenuHost = forwardRef<MessageActionMenuHandle>(function MessageActionMenuHost(_props, ref) {
  const dialog = useAppDialog();
  const [request, setRequest] = useState<MessageActionMenuRequest | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = useEvent<OpenMessageActionMenu>((nextRequest) => {
    setRequest(nextRequest);
    setIsOpen(true);
  });

  useImperativeHandle(ref, () => ({ open }), [open]);

  const setOpen = (openState: boolean) => {
    setIsOpen(openState);
    if (!openState) setRequest(null);
  };
  const copy = () => {
    if (request?.copyText === undefined || request.copyText === "") return;
    setOpen(false);
    void Clipboard.setStringAsync(request.copyText);
  };
  const fork = () => {
    const onFork = request?.onFork;
    if (onFork === undefined) return;
    setOpen(false);
    void onFork().catch((cause) => {
      dialog.alert("Fork failed", cause instanceof Error ? cause.message : "Could not fork thread");
    });
  };
  const review = () => {
    const onReview = request?.onReview;
    if (onReview === undefined) return;
    setOpen(false);
    void Promise.resolve(onReview()).catch((cause) => {
      dialog.alert("Review failed", cause instanceof Error ? cause.message : "Could not review response");
    });
  };

  return (
    <AppSheet isOpen={isOpen} onOpenChange={setOpen} contentProps={{ index: 0, enableDynamicSizing: true }}>
      <View style={styles.content}>
        <Pressable accessibilityRole="menuitem" disabled={request?.copyText === ""} onPress={copy} style={({ pressed }) => [styles.item, pressed && styles.pressed, request?.copyText === "" && styles.disabled]}>
          <Ionicons name="copy-outline" size={19} color={colors.textMuted} />
          <Text style={styles.label}>Copy</Text>
        </Pressable>
        <Pressable accessibilityRole="menuitem" disabled={request?.onFork === undefined} onPress={fork} style={({ pressed }) => [styles.item, pressed && styles.pressed, request?.onFork === undefined && styles.disabled]}>
          <Ionicons name="git-branch-outline" size={19} color={colors.textMuted} />
          <Text style={styles.label}>Fork</Text>
        </Pressable>
        <Pressable accessibilityRole="menuitem" disabled={request?.onReview === undefined} onPress={review} style={({ pressed }) => [styles.item, pressed && styles.pressed, request?.onReview === undefined && styles.disabled]}>
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.textMuted} />
          <Text style={styles.label}>Review response</Text>
        </Pressable>
      </View>
    </AppSheet>
  );
});

const styles = StyleSheet.create({
  content: { gap: 2 },
  item: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 14 },
  pressed: { backgroundColor: colors.surfaceContainerHigh },
  disabled: { opacity: 0.42 },
  label: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontFamily: "RobotoFlex-Medium" },
});
