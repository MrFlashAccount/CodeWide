import { DropdownMenu, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { height, width } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing } from "../theme";
import type { ContentMenuProps } from "./ContentMenu.types";

/** Space between the anchor and its menu, above or below it. */
const MENU_GAP = spacing.xs;

/** Compose owns the popup, clipping, anchoring, alignment and scrolling; RN
 * owns its body. Compose lines the menu up with the start, centre or end of its
 * anchor from the bounds of its own layout pass, below the anchor or above it
 * when there is no room, inside the window. Placement stays a fallback-platform
 * preference.
 */
export function ContentMenu(props: ContentMenuProps): React.JSX.Element {
  const dismiss = useEvent(() => {
    props.onOpenChange(false);
  });
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={styles.host}>
      <DropdownMenu
        color={colors.menuSurface}
        cornerRadius={radii.menu}
        expanded={props.open}
        horizontalAlignment={props.align ?? "start"}
        offsetY={MENU_GAP}
        onDismissRequest={dismiss}
      >
        <NativeMenuTrigger trigger={props.trigger} />
        <NativeMenuItems props={props} />
      </DropdownMenu>
    </Host>
  );
}

function NativeMenuTrigger({
  trigger,
}: {
  readonly trigger: ContentMenuProps["trigger"];
}): React.JSX.Element {
  return (
    <DropdownMenu.Trigger>
      <RNHostView matchContents>{trigger}</RNHostView>
    </DropdownMenu.Trigger>
  );
}

function NativeMenuItems({ props }: { readonly props: ContentMenuProps }): React.JSX.Element {
  return (
    <DropdownMenu.Items>{props.open ? <NativeMenuBody props={props} /> : null}</DropdownMenu.Items>
  );
}

function NativeMenuBody({ props }: { readonly props: ContentMenuProps }): React.JSX.Element {
  // A declared height reaches both layout trees, so the popup never waits
  // for, or clips to, a measurement of the React Native body.
  if (props.height !== undefined) {
    return (
      <RNHostView matchContents modifiers={[width(props.width), height(props.height)]}>
        <View style={{ height: props.height, width: props.width }}>{props.children}</View>
      </RNHostView>
    );
  }
  return (
    <RNHostView matchContents modifiers={[width(props.width)]}>
      <View style={{ width: props.width }}>{props.children}</View>
    </RNHostView>
  );
}

const styles = StyleSheet.create({
  host: { backgroundColor: "transparent" },
});
