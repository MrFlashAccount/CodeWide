import { DropdownMenu, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { width } from "@expo/ui/jetpack-compose/modifiers";
import { cloneElement } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radii } from "../theme";
import type { AppPopoverProps } from "./AppPopover.types";

/** Compose owns the popup, clipping, anchoring and scrolling; RN owns its body.
 * Placement/align are fallback-platform preferences: Compose fits its own anchor
 * to the available window space, rather than forcing an off-screen placement.
 */
export function AppPopover(props: AppPopoverProps) {
  const trigger = cloneElement(props.trigger, {
    onPress: (event) => {
      props.trigger.props.onPress?.(event);
      props.onOpenChange(!props.open);
    },
  });
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={styles.host}>
      <DropdownMenu
        color={colors.surfaceContainer}
        cornerRadius={radii.selected}
        expanded={props.open}
        onDismissRequest={() => props.onOpenChange(false)}
      >
        <DropdownMenu.Trigger>
          <RNHostView matchContents>{trigger}</RNHostView>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {props.open && (
            <RNHostView matchContents modifiers={[width(props.width)]}>
              <View style={{ width: props.width }}>{props.children}</View>
            </RNHostView>
          )}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { backgroundColor: "transparent" },
});
