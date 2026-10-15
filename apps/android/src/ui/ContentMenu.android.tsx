import { DropdownMenu, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { height, width } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing } from "../theme";
import type { ContentMenuProps } from "./ContentMenu.types";
import { useLayoutWidth } from "./useLayoutWidth";

/** Space between the anchor and its menu, above or below it. */
const MENU_GAP = spacing.xs;
/** A centred menu moves back by half the width it exceeds its anchor by. */
const CENTERED_SHIFT = 0.5;
/** How much of the width the menu exceeds its anchor by moves it back, per alignment. */
const ALIGN_SHIFT: Record<NonNullable<ContentMenuProps["align"]>, number> = {
  center: CENTERED_SHIFT,
  end: 1,
  start: 0,
};

/** Compose owns the popup, clipping, anchoring and scrolling; RN owns its body.
 * Compose opens the menu at its anchor's start, below the anchor or above it
 * when there is no room; `align` shifts it along the anchor by the anchor's
 * measured width, and Compose keeps it inside the window. Placement stays a
 * fallback-platform preference.
 */
export function ContentMenu(props: ContentMenuProps): React.JSX.Element {
  const dismiss = useEvent(() => {
    props.onOpenChange(false);
  });
  const anchor = useLayoutWidth();
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={styles.host}>
      <DropdownMenu
        color={colors.menuSurface}
        cornerRadius={radii.menu}
        expanded={props.open}
        offsetX={alignedOffset(props.align ?? "start", anchor.width, props.width)}
        offsetY={MENU_GAP}
        onDismissRequest={dismiss}
      >
        <NativeMenuTrigger onLayout={anchor.onLayout} trigger={props.trigger} />
        <NativeMenuItems props={props} />
      </DropdownMenu>
    </Host>
  );
}

/** How far the menu moves from the anchor's start to line up as `align` asks. */
function alignedOffset(
  align: NonNullable<ContentMenuProps["align"]>,
  anchorWidth: number | null,
  menuWidth: number,
): number {
  return anchorWidth === null ? 0 : (anchorWidth - menuWidth) * ALIGN_SHIFT[align];
}

function NativeMenuTrigger({
  onLayout,
  trigger,
}: {
  readonly onLayout: ReturnType<typeof useLayoutWidth>["onLayout"];
  readonly trigger: ContentMenuProps["trigger"];
}): React.JSX.Element {
  return (
    <DropdownMenu.Trigger>
      <RNHostView matchContents>
        <View onLayout={onLayout}>{trigger}</View>
      </RNHostView>
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
