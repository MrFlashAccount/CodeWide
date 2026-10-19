import { DropdownMenu, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { height, width } from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing } from "../theme";
import type { ContentMenuProps } from "./ContentMenu.types";
import { useAnchoredMenuSize } from "./useAnchoredMenuSize";

/** Space between the anchor and its menu, above or below it. */
const MENU_GAP = spacing.xs;

/** Compose owns the popup, clipping, anchoring and alignment; RN owns its
 * body and its scrolling. Compose lines the menu up with the start, centre or
 * end of its anchor from the bounds of its own layout pass, below the anchor or
 * above it when there is no room, inside the window. Placement stays a
 * fallback-platform preference.
 *
 * The popup's height is the body's height as React Native lays it out, kept
 * between `minHeight` and `maxHeight`, and declared to both layout trees: the
 * native host's own measurement of a React Native body collapses inside the
 * popup. The menu opens once that height is known.
 */
export function ContentMenu(props: ContentMenuProps): React.JSX.Element {
  const dismiss = useEvent(() => {
    props.onOpenChange(false);
  });
  const bounds = useAnchoredMenuSize();
  // WHY useState: the body's laid-out height is a layout measurement of this
  // menu, reported by React Native layout events; no model owns it.
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const measureContent = useEvent((_width: number, height: number) => {
    setContentHeight((current) => (current === height ? current : height));
  });
  const height =
    contentHeight === null
      ? null
      : Math.min(
          props.maxHeight ?? bounds.maxHeight,
          Math.max(props.minHeight ?? 0, contentHeight),
        );
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={styles.host}>
      <DropdownMenu
        color={colors.menuSurface}
        cornerRadius={radii.menu}
        expanded={props.open && height !== null}
        horizontalAlignment={props.align ?? "start"}
        offsetY={MENU_GAP}
        onDismissRequest={dismiss}
      >
        <NativeMenuTrigger trigger={props.trigger} />
        <NativeMenuItems
          height={height}
          onContentSizeChange={measureContent}
          open={props.open}
          width={props.width}
        >
          {props.children}
        </NativeMenuItems>
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

/** The popup's slot: the body while the menu is open, nothing otherwise. */
function NativeMenuItems({
  open,
  ...body
}: {
  readonly children: React.ReactNode;
  readonly height: number | null;
  readonly onContentSizeChange: (width: number, height: number) => void;
  readonly open: boolean;
  readonly width: number;
}): React.JSX.Element {
  return <DropdownMenu.Items>{open ? <NativeMenuBody {...body} /> : null}</DropdownMenu.Items>;
}

/**
 * The scrolling body. Until its content height is known it is laid out
 * unbounded, closed, only to be measured; then it takes the menu's height in
 * both layout trees.
 */
function NativeMenuBody({
  children,
  height: menuHeight,
  onContentSizeChange,
  width: menuWidth,
}: {
  readonly children: React.ReactNode;
  readonly height: number | null;
  readonly onContentSizeChange: (width: number, height: number) => void;
  readonly width: number;
}): React.JSX.Element {
  const scroll = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      onContentSizeChange={onContentSizeChange}
      showsVerticalScrollIndicator={false}
      testID="content-menu-body"
    >
      {children}
    </ScrollView>
  );
  if (menuHeight === null) {
    return (
      <RNHostView matchContents modifiers={[width(menuWidth)]}>
        <View style={{ width: menuWidth }} testID="content-menu">
          {scroll}
        </View>
      </RNHostView>
    );
  }
  return (
    <RNHostView matchContents modifiers={[width(menuWidth), height(menuHeight)]}>
      <View style={{ height: menuHeight, width: menuWidth }} testID="content-menu">
        {scroll}
      </View>
    </RNHostView>
  );
}

const styles = StyleSheet.create({
  host: { backgroundColor: "transparent" },
});
