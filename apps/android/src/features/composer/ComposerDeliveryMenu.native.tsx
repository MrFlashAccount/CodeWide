import { cloneElement, useState } from "react";
import { StyleSheet, View } from "react-native";
import { touchTarget } from "../../theme";
import { CodeWideMenu } from "../../ui/CodeWideMenu.native";
import type { ComposerDeliveryMenuProps } from "./ComposerDeliveryMenu.types";

/** Keep the draggable RN button outside Compose's bounded menu trigger host. */
export function ComposerDeliveryMenu(props: ComposerDeliveryMenuProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.root}>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <CodeWideMenu
          actions={props.actions}
          expanded={expanded}
          onDismiss={() => setExpanded(false)}
          onSelect={(id) => {
            setExpanded(false);
            props.onSelect(id);
          }}
        >
          <View pointerEvents="none" style={styles.anchor} />
        </CodeWideMenu>
      </View>
      {cloneElement(props.children, {
        onLongPress: (event) => {
          props.children.props.onLongPress?.(event);
          props.onOpen();
          setExpanded(true);
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: touchTarget, height: touchTarget, flexShrink: 0, overflow: "visible", zIndex: 4 },
  anchor: { width: touchTarget, height: touchTarget },
});
