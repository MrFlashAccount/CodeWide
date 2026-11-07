import { DropdownMenu, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { fillMaxSize, height, width } from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing } from "../theme";
import type { ContentMenuProps } from "./ContentMenu.types";
import { useAnchoredMenuSize } from "./useAnchoredMenuSize";

/** Space between the anchor and its menu, above or below it. */
const MENU_GAP = spacing.xs;
/** The menu's anchor is the whole host, which covers the trigger's box. */
const ANCHOR_MODIFIERS = [fillMaxSize()];

/** Compose owns the popup, clipping, anchoring and alignment; RN owns its
 * trigger, its body and its scrolling. Compose lines the menu up with the
 * start, centre or end of its anchor from the bounds of its own layout pass,
 * below the anchor or above it when there is no room, inside the window.
 * Placement stays a fallback-platform preference.
 *
 * The trigger stays in the React Native tree: Yoga sizes the anchor box
 * around it in the same layout pass as its content, and the Compose host
 * only fills that box behind it, to give the popup its anchor bounds. A
 * trigger hosted inside Compose would be sized by a round trip instead
 * (Yoga lays out the trigger, Compose measures it, the host's Yoga width is
 * written back on a later frame), so a trigger whose content changed would
 * keep its previous width for frames and could settle narrower than its
 * content.
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
    <View
      collapsable={false}
      style={[styles.anchor, props.anchorStyle]}
      testID="content-menu-anchor"
    >
      <NativeMenuHost
        align={props.align ?? "start"}
        dismiss={dismiss}
        height={height}
        measureContent={measureContent}
        open={props.open}
        revealed={props.open && height !== null}
        width={props.width}
      >
        {props.children}
      </NativeMenuHost>
      {props.trigger}
    </View>
  );
}

/**
 * The Compose host behind the trigger: it covers the anchor box, takes no
 * part in its layout, and gives the popup that box as its anchor bounds.
 */
function NativeMenuHost({
  align,
  children,
  dismiss,
  height,
  measureContent,
  open,
  revealed,
  width,
}: {
  readonly align: "start" | "center" | "end";
  readonly children: React.ReactNode;
  readonly dismiss: () => void;
  readonly height: number | null;
  readonly measureContent: (width: number, height: number) => void;
  readonly open: boolean;
  /** The popup is shown: open, and its body's height is known. */
  readonly revealed: boolean;
  readonly width: number;
}): React.JSX.Element {
  return (
    <Host colorScheme="dark" pointerEvents="box-none" style={styles.host}>
      <DropdownMenu
        color={colors.menuSurface}
        cornerRadius={radii.menu}
        expanded={revealed}
        horizontalAlignment={align}
        modifiers={ANCHOR_MODIFIERS}
        offsetY={MENU_GAP}
        onDismissRequest={dismiss}
      >
        <NativeMenuItems
          height={height}
          onContentSizeChange={measureContent}
          open={open}
          width={width}
        >
          {children}
        </NativeMenuItems>
      </DropdownMenu>
    </Host>
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
  /** Sized by its trigger alone; the host behind it takes no part in layout. */
  anchor: { position: "relative" },
  host: {
    backgroundColor: "transparent",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
