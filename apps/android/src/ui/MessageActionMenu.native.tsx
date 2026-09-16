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
import { CodeWideMenu, type CodeWideMenuAction } from "./CodeWideMenu.native";
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
  if (open === null) {
    throw new Error("Message actions require MessageActionMenuProvider");
  }
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

const MessageActionMenuHost = forwardRef<MessageActionMenuHandle>(
  function MessageActionMenuHost(_props, ref) {
    const dialog = useAppDialog();
    const rootRef = useRef<View>(null);
    const generationRef = useRef(0);
    const [menu, setMenu] = useState<{
      anchor: { height: number; left: number; top: number; width: number };
      generation: number;
      request: MessageActionMenuRequest;
    } | null>(null);

    const open = useEvent<OpenMessageActionMenu>((nextRequest, { height, pageX, pageY, width }) => {
      rootRef.current?.measureInWindow((rootX, rootY) => {
        generationRef.current += 1;
        setMenu({
          anchor: { height, left: pageX - rootX, top: pageY - rootY, width },
          generation: generationRef.current,
          request: nextRequest,
        });
      });
    });

    useImperativeHandle(ref, () => ({ open }), [open]);

    const dismiss = () => {
      setMenu(null);
    };
    const handleSelect = (id: "copy" | "fork" | "review") => {
      const selectedRequest = menu?.request;
      if (selectedRequest === undefined) {
        return;
      }
      dismiss();
      void Haptics.selectionAsync().catch(() => undefined);
      if (id === "copy") {
        if (selectedRequest.copyText !== "") {
          Clipboard.setStringAsync(selectedRequest.copyText).catch((error: unknown) => {
            dialog.alert("Copy failed", error instanceof Error ? error.message : "Could not copy");
          });
        }
        return;
      }
      if (id === "review") {
        if (selectedRequest.onReview !== undefined) {
          void Promise.resolve(selectedRequest.onReview()).catch((error: unknown) => {
            dialog.alert(
              "Review failed",
              error instanceof Error ? error.message : "Could not review response",
            );
          });
        }
        return;
      }
      if (selectedRequest.onFork !== undefined) {
        void selectedRequest.onFork().catch((error: unknown) => {
          dialog.alert(
            "Fork failed",
            error instanceof Error ? error.message : "Could not fork thread",
          );
        });
      }
    };

    const request = menu?.request;
    const canCopy = request !== undefined && request.copyText !== "";
    const canFork = request?.onFork !== undefined;
    const canReview = request?.onReview !== undefined;
    const actions: readonly CodeWideMenuAction[] = [
      { disabled: !canCopy, icon: "copy-outline", id: "copy", label: "Copy" },
      { disabled: !canFork, icon: "git-branch-outline", id: "fork", label: "Fork" },
      {
        disabled: !canReview,
        icon: "chatbubble-ellipses-outline",
        id: "review",
        label: "Review response",
      },
    ];

    return (
      <View collapsable={false} pointerEvents="box-none" ref={rootRef} style={styles.host}>
        <CodeWideMenu
          actions={actions}
          expanded={menu !== null}
          key={menu?.generation ?? "closed"}
          onDismiss={dismiss}
          onSelect={(id) => {
            if (id === "copy" || id === "fork" || id === "review") {
              handleSelect(id);
            }
          }}
          style={[styles.anchor, menu?.anchor ?? { height: 1, left: 0, top: 0, width: 1 }]}
        >
          <View
            pointerEvents="none"
            style={{ height: menu?.anchor.height ?? 1, width: menu?.anchor.width ?? 1 }}
          />
        </CodeWideMenu>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
  },
  host: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
