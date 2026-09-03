import type { ComponentProps, ReactNode } from "react";
import { Pressable } from "react-native";

import type {
  UsageAccountViewModel,
  UsageContextViewModel,
  UsagePopoverActionViewModel,
  UsageSessionViewModel,
} from "./usageTypes";

export type {
  UsageAccountViewModel,
  UsageContextViewModel,
  UsagePopoverActionViewModel,
  UsageSessionViewModel,
} from "./usageTypes";

interface UsagePopoverViewProps {
  accounts?: readonly UsageAccountViewModel[];
  actions?: readonly UsagePopoverActionViewModel[];
  align?: "center" | "end" | "start";
  children: ReactNode;
  context?: UsageContextViewModel | null;
  placement?: "bottom" | "left" | "right" | "top";
  session?: UsageSessionViewModel | null;
  triggerAccessibilityLabel: string;
  triggerStyle?: ComponentProps<typeof Pressable>["style"];
}

export function UsagePopoverView(props: UsagePopoverViewProps): React.JSX.Element {
  const { children, triggerAccessibilityLabel, triggerStyle } = props;
  return (
    <Pressable
      accessibilityLabel={triggerAccessibilityLabel}
      accessibilityRole="button"
      style={triggerStyle}
    >
      {children}
    </Pressable>
  );
}
