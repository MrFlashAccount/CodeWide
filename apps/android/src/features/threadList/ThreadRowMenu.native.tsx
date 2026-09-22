import { selectionAsync } from "expo-haptics";
import { useRef, useState, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { CodeWideMenu } from "../../ui/CodeWideMenu.native";
import type { ThreadRowMenuProps } from "./ThreadRowMenu.types";

const ROW_MENU_WIDTH = 288;

type MenuAnchor = {
  readonly height: number;
  readonly rowKey: string;
  readonly width: number;
};

/** Keeps Compose out of idle rows; only the opened popup owns a native host. */
export function ThreadRowMenu({
  actions,
  children,
  onSelect,
  rowKey,
}: ThreadRowMenuProps): ReactElement {
  const rootRef = useRef<View>(null);
  const requestRef = useRef(0);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const visibleAnchor = anchor?.rowKey === rowKey ? anchor : null;
  const publishAnchor = useEvent((next: MenuAnchor, request: number) => {
    if (next.rowKey === rowKey && request === requestRef.current && rootRef.current !== null) {
      setAnchor(next);
    }
  });
  const open = useEvent(() => {
    const root = rootRef.current;
    const request = ++requestRef.current;
    root?.measureInWindow((...bounds) => {
      const [, , width, height] = bounds;
      if (width > 0 && height > 0 && rootRef.current === root) {
        publishAnchor({ height, rowKey, width }, request);
      }
    });
  });
  const dismiss = useEvent(() => {
    requestRef.current += 1;
    setAnchor(null);
  });
  const select = useEvent((id: string) => {
    if (visibleAnchor === null || rootRef.current === null) {
      return;
    }
    const action = actions.find((candidate) => candidate.id === id);
    if (action === undefined || action.disabled === true) {
      return;
    }
    if (action.keepOpen !== true) {
      dismiss();
    }
    void selectionAsync().catch(() => undefined);
    onSelect(id);
  });

  return (
    <View collapsable={false} ref={rootRef} style={styles.root}>
      {children(open)}
      {visibleAnchor !== null && (
        <CodeWideMenu
          actions={actions}
          expanded
          menuWidth={Math.min(ROW_MENU_WIDTH, visibleAnchor.width)}
          onDismiss={dismiss}
          onSelect={select}
          style={styles.anchor}
        >
          <View
            pointerEvents="none"
            style={{ height: visibleAnchor.height, width: visibleAnchor.width }}
          />
        </CodeWideMenu>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  root: {
    alignSelf: "stretch",
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
});
