import { DropdownMenu, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { width } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii } from "../theme";
import type { ContentMenuProps } from "./ContentMenu.types";

/** Compose owns the popup, clipping, anchoring and scrolling; RN owns its body.
 * Placement/align are fallback-platform preferences: Compose fits its own anchor
 * to the available window space, rather than forcing an off-screen placement.
 */
export function ContentMenu(props: ContentMenuProps): React.JSX.Element {
  const dismiss = useEvent(() => {
    props.onOpenChange(false);
  });
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={styles.host}>
      <NativeContentMenu dismiss={dismiss} props={props} />
    </Host>
  );
}

function NativeContentMenu({
  dismiss,
  props,
}: {
  readonly dismiss: () => void;
  readonly props: ContentMenuProps;
}): React.JSX.Element {
  return (
    <DropdownMenu
      color={colors.surfaceContainer}
      cornerRadius={radii.selected}
      expanded={props.open}
      onDismissRequest={dismiss}
    >
      <NativeMenuTrigger trigger={props.trigger} />
      <NativeMenuItems props={props} />
    </DropdownMenu>
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
  return (
    <RNHostView matchContents modifiers={[width(props.width)]}>
      <View style={{ width: props.width }}>{props.children}</View>
    </RNHostView>
  );
}

const styles = StyleSheet.create({
  host: { backgroundColor: "transparent" },
});
