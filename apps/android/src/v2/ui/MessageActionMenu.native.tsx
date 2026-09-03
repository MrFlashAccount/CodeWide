import { setStringAsync } from "expo-clipboard";
import { selectionAsync } from "expo-haptics";
import {
  createContext,
  forwardRef,
  useContext,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { useAppDialog } from "./AppDialog";
import { CodeWideMenu } from "./CodeWideMenu.native";
import type {
  MessageActionMenuProviderProps,
  MessageActionMenuRequest,
  OpenMessageActionMenu,
} from "./MessageActionMenu.types";
import { messageActionMenuItems } from "./messageActionMenuItems";

interface MessageActionMenuHandle {
  open: OpenMessageActionMenu;
}

interface MessageActionMenuState {
  anchor: { height: number; left: number; top: number; width: number };
  generation: number;
  request: MessageActionMenuRequest;
}

interface ConfirmedAction {
  action(): Promise<void> | void;
  fallback: string;
  title: string;
}

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
    const alert = useAppDialog();
    const rootRef = useRef<View>(null);
    const generationRef = useRef(0);
    const [menu, setMenu] = useState<MessageActionMenuState | null>(null);

    const open = useEvent<OpenMessageActionMenu>((nextRequest, anchor) => {
      const { height, pageX, pageY, width } = anchor;
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

    const dismiss = useEvent(() => setMenu(null));
    const runAction = useEvent(
      (title: string, fallback: string, action: (() => Promise<void> | void) | undefined) => {
        if (action === undefined) return;
        void Promise.resolve(action()).catch((cause: unknown) => {
          alert(title, cause instanceof Error ? cause.message : fallback);
        });
      },
    );
    const confirmedActionRef = useRef<ConfirmedAction | null>(null);
    const runConfirmedAction = useEvent(() => {
      const confirmed = confirmedActionRef.current;
      if (confirmed === null) return;
      confirmedActionRef.current = null;
      runAction(confirmed.title, confirmed.fallback, confirmed.action);
    });
    const confirmDestructive = useEvent((request: ConfirmedAction, prompt: string) => {
      confirmedActionRef.current = request;
      alert(prompt, "All later turns will be removed.", [
        { text: "Cancel", style: "cancel" },
        {
          onPress: runConfirmedAction,
          style: "destructive",
          text: "Continue",
        },
      ]);
    });
    const handleSelect = useEvent((id: string) => {
      if (
        id !== "copy" &&
        id !== "edit" &&
        id !== "fork" &&
        id !== "interrupt" &&
        id !== "review" &&
        id !== "rollback"
      )
        return;
      const selectedRequest = menu?.request;
      if (selectedRequest === undefined) return;
      dismiss();
      void selectionAsync().catch(() => undefined);
      if (id === "copy") {
        if (selectedRequest.copyText !== "")
          void setStringAsync(selectedRequest.copyText).catch(() => undefined);
        return;
      }
      if (id === "review") {
        runAction("Review failed", "Could not review response", selectedRequest.onReview);
        return;
      }
      if (id === "edit") {
        if (selectedRequest.onEdit !== undefined) {
          confirmDestructive(
            {
              action: selectedRequest.onEdit,
              fallback: "Could not edit message",
              title: "Edit failed",
            },
            "Edit from this message?",
          );
        }
        return;
      }
      if (id === "interrupt") {
        runAction("Stop failed", "Could not stop turn", selectedRequest.onInterrupt);
        return;
      }
      if (id === "rollback") {
        if (selectedRequest.onRollback !== undefined) {
          confirmDestructive(
            {
              action: selectedRequest.onRollback,
              fallback: "Could not roll back turn",
              title: "Rollback failed",
            },
            "Roll back to this message?",
          );
        }
        return;
      }
      runAction("Fork failed", "Could not fork thread", selectedRequest.onFork);
    });

    const request = menu?.request;
    const actions = messageActionMenuItems(request);

    return (
      <View ref={rootRef} collapsable={false} pointerEvents="box-none" style={styles.host}>
        <CodeWideMenu
          key={menu?.generation ?? "closed"}
          actions={actions}
          expanded={menu !== null}
          style={[styles.anchor, menu?.anchor ?? { left: 0, top: 0, width: 1, height: 1 }]}
          onDismiss={dismiss}
          onSelect={handleSelect}
        >
          <View
            pointerEvents="none"
            style={{ width: menu?.anchor.width ?? 1, height: menu?.anchor.height ?? 1 }}
          />
        </CodeWideMenu>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  anchor: { position: "absolute" },
  host: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
});
