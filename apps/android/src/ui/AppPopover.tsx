import { Popover } from "heroui-native/popover";
import { ScrollView, useWindowDimensions } from "react-native";

import { radii } from "../theme";
import type { AppPopoverProps } from "./AppPopover.types";

/** Non-Android fallback; Android resolves to the native Compose shell. */
export function AppPopover(props: AppPopoverProps) {
  const { height } = useWindowDimensions();
  return (
    <Popover presentation="popover" isOpen={props.open} onOpenChange={props.onOpenChange}>
      <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay className="bg-backdrop" />
        <Popover.Content
          presentation="popover"
          placement={props.placement ?? "top"}
          align={props.align ?? "start"}
          offset={8}
          width={props.width}
          className="border border-border"
          style={{ padding: 0, borderRadius: radii.selected, overflow: "hidden" }}
        >
          <ScrollView style={{ maxHeight: Math.max(1, height - 24) }}>{props.children}</ScrollView>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
