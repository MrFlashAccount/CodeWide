import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  createContext,
  forwardRef,
  useContext,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { useAppDialog } from "./AppDialog";
import {
  CodeWideMenu,
  type CodeWideMenuAction,
} from "./CodeWideMenu.native";
import type {
  MessageActionMenuProviderProps,
  MessageActionMenuRequest,
  OpenMessageActionMenu,
} from "./MessageActionMenu.types";

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
  const rootRef = useRef<View>(null);
  const generationRef = useRef(0);
  const [menu, setMenu] = useState<{
    request: MessageActionMenuRequest;
    anchor: { left: number; top: number; width: number; height: number };
    generation: number;
  } | null>(null);

  const open = useEvent<OpenMessageActionMenu>((nextRequest, { pageX, pageY, width, height }) => {
    rootRef.current?.measureInWindow((rootX, rootY) => {
      generationRef.current += 1;
      setMenu({
        request: nextRequest,
        anchor: { left: pageX - rootX, top: pageY - rootY, width, height },
        generation: generationRef.current,
      });
    });
  });

  useImperativeHandle(ref, () => ({ open }), [open]);

  const dismiss = () => {
    setMenu(null);
  };
  const handleSelect = (id: "copy" | "fork" | "review") => {
    const selectedRequest = menu?.request;
    if (selectedRequest === undefined) return;
    dismiss();
    void Haptics.selectionAsync().catch(() => undefined);
    if (id === "copy") {
      if (selectedRequest.copyText !== "") void Clipboard.setStringAsync(selectedRequest.copyText);
      return;
    }
    if (id === "review") {
      if (selectedRequest.onReview !== undefined) {
        void Promise.resolve(selectedRequest.onReview()).catch((cause) => {
          dialog.alert("Review failed", cause instanceof Error ? cause.message : "Could not review response");
        });
      }
      return;
    }
    if (selectedRequest.onFork !== undefined) {
      void selectedRequest.onFork().catch((cause) => {
        dialog.alert("Fork failed", cause instanceof Error ? cause.message : "Could not fork thread");
      });
    }
  };

  const request = menu?.request;
  const canCopy = request !== undefined && request.copyText !== "";
  const canFork = request?.onFork !== undefined;
  const canReview = request?.onReview !== undefined;
  const actions: readonly CodeWideMenuAction[] = [
    { id: "copy", label: "Copy", icon: "copy-outline", disabled: !canCopy },
    { id: "fork", label: "Fork", icon: "git-branch-outline", disabled: !canFork },
    {
      id: "review",
      label: "Review response",
      icon: "chatbubble-ellipses-outline",
      disabled: !canReview,
    },
  ];

  return (
    <View ref={rootRef} collapsable={false} pointerEvents="box-none" style={styles.host}>
      <CodeWideMenu
        key={menu?.generation ?? "closed"}
        actions={actions}
        expanded={menu !== null}
        style={[
          styles.anchor,
          menu?.anchor ?? { left: 0, top: 0, width: 1, height: 1 },
        ]}
        onDismiss={dismiss}
        onSelect={(id) => handleSelect(id as "copy" | "fork" | "review")}
      >
        <View
          pointerEvents="none"
          style={{ width: menu?.anchor.width ?? 1, height: menu?.anchor.height ?? 1 }}
        />
      </CodeWideMenu>
    </View>
  );
});

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
  },
  host: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
